"""Convert downloaded audio with validated codec settings; never invoke a shell."""
import base64
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, ID3, SYLT, USLT, Frames
from mutagen.mp4 import MP4, MP4Cover
from mutagen.apev2 import APEBinaryValue
from worker_safety import read_audio_tags

PROFILES = {
    'mp3': ('.mp3', 'mp3', ['-c:a', 'libmp3lame']),
    'aac': ('.m4a', 'aac', ['-c:a', 'aac']),
    'vorbis': ('.ogg', 'vorbis', ['-c:a', 'libvorbis']),
    'opus': ('.opus', 'opus', ['-c:a', 'libopus']),
    'ape': ('.ape', 'ape', []),
    'alac': ('.m4a', 'alac', ['-c:a', 'alac']),
    'dsd': ('.dsf', 'dsd_lsbf_planar', []),
    'tta': ('.tta', 'tta', ['-c:a', 'tta']),
}
FORMAT_FIELDS = json.loads((Path(__file__).resolve().parents[1] / 'shared/audio-options.json').read_text(encoding='utf-8'))

AUDIO = {'.flac', '.mp3', '.m4a', '.ogg', '.opus', '.ape', '.tta', '.dsf'}
# Common music metadata is translated rather than copying container-specific blobs.
TAGS = {
    'title': ('TIT2', '\xa9nam'), 'artist': ('TPE1', '\xa9ART'), 'album': ('TALB', '\xa9alb'),
    'albumartist': ('TPE2', 'aART'), 'tracknumber': ('TRCK', 'trkn'), 'discnumber': ('TPOS', 'disk'),
    'date': ('TDRC', '\xa9day'), 'genre': ('TCON', '\xa9gen'), 'composer': ('TCOM', '\xa9wrt'),
    'copyright': ('TCOP', 'cprt'),
}


class ConversionError(ValueError):
    pass


def normalize_options(output_format, options):
    if not isinstance(output_format, str) or output_format not in FORMAT_FIELDS or not isinstance(options, dict):
        raise ConversionError('Некорректные настройки формата.')
    fields = FORMAT_FIELDS[output_format]
    if any(key not in fields for key in options):
        raise ConversionError('Неизвестный параметр формата.')
    result = {}
    for key, field in fields.items():
        value = options.get(key, field['default'])
        if not any(type(value) is type(choice) and value == choice for choice, _ in field['choices']):
            raise ConversionError('Недопустимое значение параметра формата.')
        result[key] = value
    return result


def codec_args(output_format, options, bits):
    args = list(PROFILES[output_format][2])
    if output_format == 'mp3':
        args += ['-q:a', str(options['quality'])] if options['mode'] == 'vbr' else ['-b:a', f"{options['bitrate']}k"]
    elif output_format == 'aac':
        args += ['-b:a', f"{options['bitrate']}k"]
    elif output_format == 'vorbis':
        args += ['-q:a', str(options['quality'])]
    elif output_format == 'opus':
        args += ['-b:a', f"{options['bitrate']}k", '-vbr', {'vbr': 'on', 'cbr': 'off', 'cvbr': 'constrained'}[options['mode']],
                 '-compression_level', str(options['compression']), '-ar', '48000']
    elif output_format in {'alac', 'tta'}:
        sample_format = ('s16' if bits <= 16 else 's32') + ('p' if output_format == 'alac' else '')
        args += ['-sample_fmt', sample_format, '-bits_per_raw_sample', str(max(16, bits))]
    if options.get('sampleRate'):
        args += ['-ar', str(options['sampleRate'])]
    return args


def encoder(name):
    local = Path(__file__).resolve().parents[1] / '.runtime/audio-codecs/bin' / name
    return shutil.which(name) or (str(local) if local.is_file() and os.access(local, os.X_OK) else None)


def ensure_encoder(output_format):
    if output_format == 'original':
        return
    if output_format not in PROFILES:
        raise ConversionError('Неизвестный выходной формат.')
    required = ['ffmpeg', 'ffprobe'] + ({'ape': ['qws-mac'], 'dsd': ['sox-dsd']}.get(output_format, []))
    if any(not encoder(name) for name in required):
        raise ConversionError('Кодировщик не установлен на сервере. Установите аудиокодеки или выберите исходный формат.')


def codec_environment():
    return {k: v for k, v in os.environ.items() if k not in {'QOBUZ_AUTH_TOKEN', 'QOBUZ_USER_ID', 'ADMIN_PASSWORD', 'WEB_PASSWORD'}}


def probe(path):
    result = subprocess.run([encoder('ffprobe'), '-v', 'error', '-protocol_whitelist', 'file',
        '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,channels,bit_rate,bits_per_raw_sample,bits_per_sample,duration:format=duration',
        '-of', 'json', str(path)], stdin=subprocess.DEVNULL, capture_output=True, timeout=30, check=True, env=codec_environment())
    data = json.loads(result.stdout)
    stream = data['streams'][0]
    duration = float(stream.get('duration') or data['format']['duration'])
    if not math.isfinite(duration) or duration <= 0 or int(stream['channels']) not in (1, 2):
        raise ConversionError('Поддерживаются непустые моно- и стереозаписи.')
    return stream, duration


def budget(root):
    used = sum(p.stat().st_size for p in root.rglob('*') if not p.is_symlink() and p.is_file())
    if used > int(os.environ.get('MAX_JOB_BYTES', 10 * 1024**3)) or shutil.disk_usage(root).free < int(os.environ.get('MIN_FREE_BYTES', 1024**3)):
        raise ConversionError('Недостаточно места для конвертации.')


def run(command, root):
    # Inherit the worker's process group so cancellation also stops encoders.
    child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=codec_environment())
    deadline = time.monotonic() + 600
    try:
        while True:
            try:
                code = child.wait(timeout=0.2)
                break
            except subprocess.TimeoutExpired:
                budget(root)
                if time.monotonic() >= deadline:
                    raise ConversionError('Превышено время конвертации трека.')
        if code:
            raise ConversionError('Кодировщик не смог обработать трек.')
        budget(root)
    finally:
        if child.poll() is None:
            child.kill()
        child.wait()


def copy_tags(source, target):
    old, new = read_audio_tags(source), read_audio_tags(target)
    if old is None or new is None:
        raise ConversionError('Не удалось прочитать метаданные аудиофайла.')
    if new.tags is None:
        new.add_tags()
    for key, (frame, atom) in TAGS.items():
        values = old.get(frame, []) if isinstance(old.tags, ID3) else old.get(atom if isinstance(old, MP4) else key, [])
        if hasattr(values, 'text'):
            values = values.text
        if isinstance(old, MP4) and atom in ('trkn', 'disk'):
            values = ['/'.join(str(n) for n in pair if n) for pair in values]
        values = [str(value) for value in values]
        if not values:
            continue
        if isinstance(new.tags, ID3):
            new.tags.setall(frame, [Frames[frame](encoding=3, text=values)])
        elif isinstance(new, MP4):
            new[atom] = [tuple(int(n) for n in (values[0].split('/') + ['0'])[:2])] if atom in ('trkn', 'disk') else values
        else:
            new[key] = values
    # Preserve plain and synchronized lyrics even when no new LRCLIB lookup is requested.
    if isinstance(old.tags, ID3):
        plain = next(iter(old.tags.getall('USLT')), None)
        synced = next(iter(old.tags.getall('SYLT')), None)
        plain = plain.text if plain else ''
        lines = synced.text if synced else []
        lrc = '\n'.join(f'[{ms//60000:02}:{ms//1000%60:02}.{ms%1000:03}]{text}' for text, ms in lines)
    else:
        plain = str((old.get('\xa9lyr' if isinstance(old, MP4) else 'LYRICS', ['']) or [''])[0])
        lrc = str((old.get('----:com.apple.iTunes:SYNCEDLYRICS' if isinstance(old, MP4) else 'SYNCEDLYRICS', ['']) or [''])[0])
        from lyrics import parse_lrc
        lines = parse_lrc(lrc, old.info.length) if lrc else []
    if plain or lrc:
        from lyrics import tag_audio
        tag_audio(new, {'plain': plain, 'lrc': lrc, 'lines': lines})
    pictures = []
    if isinstance(old, FLAC):
        pictures = old.pictures
    elif isinstance(old.tags, ID3):
        for cover in old.tags.getall('APIC'):
            picture = Picture(); picture.data = cover.data; picture.mime = cover.mime; picture.type = cover.type; pictures.append(picture)
    elif isinstance(old, MP4):
        for cover in old.get('covr', []):
            picture = Picture(); picture.data = bytes(cover); picture.mime = 'image/png' if cover.imageformat == MP4Cover.FORMAT_PNG else 'image/jpeg'; picture.type = 3; pictures.append(picture)
    elif source.suffix.lower() == '.ape' and old.get('Cover Art (Front)'):
        data = bytes(old['Cover Art (Front)']).split(b'\0', 1)[1]
        picture = Picture(); picture.data = data; picture.mime = 'image/png' if data.startswith(b'\x89PNG') else 'image/jpeg'; picture.type = 3; pictures.append(picture)
    else:
        pictures = [Picture(base64.b64decode(value)) for value in old.get('metadata_block_picture', [])]
    if pictures:
        cover = pictures[0]
        if isinstance(new.tags, ID3):
            new.tags.setall('APIC', [APIC(encoding=3, mime=cover.mime, type=3, desc='', data=cover.data)])
        elif isinstance(new, MP4):
            new['covr'] = [MP4Cover(cover.data, imageformat=MP4Cover.FORMAT_PNG if cover.mime == 'image/png' else MP4Cover.FORMAT_JPEG)]
        elif target.suffix == '.ape':
            new['Cover Art (Front)'] = APEBinaryValue(b'cover\x00' + cover.data)
        else:
            new['metadata_block_picture'] = [base64.b64encode(cover.write()).decode('ascii')]
    new.save()


def convert_file(path, output_format, root, options=None):
    options = normalize_options(output_format, {} if options is None else options)
    suffix, codec, args = PROFILES[output_format]
    info, duration = probe(path)
    destination = path.with_suffix(suffix)
    if destination != path and (destination.exists() or destination.is_symlink()):
        raise ConversionError('Имя выходного файла уже занято.')
    bits = options.get('bitDepth') or int(info.get('bits_per_raw_sample') or info.get('bits_per_sample') or 24) or 24
    args = codec_args(output_format, options, bits)
    if output_format in {'ape', 'alac'} and bits > 24:
        raise ConversionError('Для APE и ALAC поддерживается PCM до 24 бит.')
    print(f'Конвертация: {path.name} → {output_format.upper()}', flush=True)
    with tempfile.TemporaryDirectory(prefix='.qws-convert-', dir=path.parent) as directory:
        output = Path(directory) / ('audio' + suffix)
        ffmpeg = [encoder('ffmpeg'), '-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file', '-i', str(path), '-map', '0:a:0', '-map_metadata', '0', '-vn', '-threads', '1']
        if output_format in {'ape', 'dsd'}:
            intermediate = Path(directory) / ('pcm.wav' if output_format == 'ape' else 'pcm.f32')
            if output_format == 'ape':
                run(ffmpeg + ['-c:a', 'pcm_s24le' if bits > 16 else 'pcm_s16le'] + (['-ar', str(options['sampleRate'])] if options['sampleRate'] else []) + ['-write_bext', '0', str(intermediate)], root)
                run([encoder('qws-mac'), str(intermediate), str(output), str(options['compression'])], root)
            else:
                run(ffmpeg + ['-c:a', 'pcm_f32le', '-f', 'f32le', str(intermediate)], root)
                # Feed only trusted, generated raw PCM to the DSD-capable SoX fork.
                run([encoder('sox-dsd'), '-t', 'f32', '-L', '-r', str(info['sample_rate']), '-c', str(info['channels']), str(intermediate),
                     '-r', str(options['dsdRate']), str(output), 'gain', str(-options['headroom']), 'rate', '-v', str(options['dsdRate']), 'sdm'], root)
            intermediate.unlink()
        else:
            run(ffmpeg + args + [str(output)], root)
        converted, length = probe(output)
        if converted['codec_name'] != codec or abs(length - duration) > 0.25:
            raise ConversionError('Проверка сконвертированного файла не пройдена.')
        if options.get('sampleRate') and int(converted['sample_rate']) != options['sampleRate']:
            raise ConversionError('Частота результата не соответствует выбранной.')
        if options.get('bitDepth') and int(converted.get('bits_per_raw_sample') or converted.get('bits_per_sample') or 0) != options['bitDepth']:
            raise ConversionError('Битность результата не соответствует выбранной.')
        if output_format == 'dsd' and int(converted['sample_rate']) * 8 != options['dsdRate']:
            raise ConversionError('Частота DSD не соответствует выбранной.')
        copy_tags(path, output)
        budget(root)
        os.replace(output, destination)
        if destination != path:
            path.unlink()


def convert_downloads(directory, output_format='original', options=None):
    options = normalize_options(output_format, {} if options is None else options)
    ensure_encoder(output_format)
    if output_format == 'original':
        return
    root = Path(directory).resolve(strict=True)
    failed = False
    for folder, directories, files in os.walk(root, followlinks=False):
        directories[:] = [name for name in directories if not name.startswith('.qws-') and not Path(folder, name).is_symlink()]
        for name in files:
            path = Path(folder, name)
            if name.startswith('.qws-') or path.is_symlink() or path.suffix.lower() not in AUDIO or not path.is_file():
                continue
            try:
                convert_file(path, output_format, root, options)
            except Exception:
                failed = True
                print(f'Не удалось конвертировать {path.name}; исходный файл сохранён.', flush=True)
    if failed:
        raise ConversionError('Конвертация не завершена; исходные файлы не заменены при ошибке.')
