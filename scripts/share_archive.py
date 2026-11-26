"""Read bounded audio previews from a completed ZIP; never extract files."""
import base64
import json
import math
from pathlib import PurePosixPath
import re
import stat
import struct
import subprocess
import sys
import zipfile

AUDIO = {'.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
         '.opus': 'audio/ogg', '.ape': 'audio/x-ape', '.tta': 'audio/x-tta', '.dsf': 'audio/dsf', '.wav': 'audio/wav', '.aif': 'audio/aiff', '.aiff': 'audio/aiff'}


def clean(value):
    return re.sub(r'[\x00-\x1f\x7f]', ' ', str(value or '')).strip()[:200]


def members(archive):
    if len(archive.infolist()) > 10000:
        raise ValueError('Archive too large')
    result = []
    for index, item in enumerate(archive.infolist()):
        path = PurePosixPath(item.filename)
        if (path.suffix.lower() in AUDIO and not item.is_dir() and not path.is_absolute()
                and '..' not in path.parts and '\\' not in item.filename and '\x00' not in item.filename
                and not any(part.startswith('.qws-') for part in path.parts)
                and not stat.S_ISLNK(item.external_attr >> 16) and not item.flag_bits & 1
                and item.compress_type == zipfile.ZIP_STORED and 0 < item.file_size <= 10 * 1024**3
                and item.file_size == item.compress_size):
            result.append((index, item))
    return result


class BoundedReader:
    def __init__(self, archive, item):
        source = archive.fp
        source.seek(item.header_offset)
        header = source.read(30)
        if len(header) != 30 or header[:4] != b'PK\x03\x04' or struct.unpack_from('<H', header, 8)[0] != 0:
            raise ValueError('Invalid local header')
        name_length, extra_length = struct.unpack_from('<HH', header, 26)
        name = source.read(name_length).decode('utf-8' if item.flag_bits & 0x800 else 'cp437')
        if name != item.orig_filename:
            raise ValueError('Invalid member name')
        self.start = item.header_offset + 30 + name_length + extra_length
        self.length = item.file_size
        if self.start + self.length > archive.start_dir:
            raise ValueError('Invalid member bounds')
        self.source, self.position, self.remaining = source, 0, 32 * 1024**2
        self.archive = archive
        if not hasattr(archive, '_metadata_budget'):
            archive._metadata_budget = 64 * 1024**2
        self.name = item.filename
    def read(self, count=-1):
        count = self.length - self.position if count < 0 else min(count, self.length - self.position)
        if count > min(self.remaining, self.archive._metadata_budget, 16 * 1024**2):
            raise ValueError('Metadata budget exceeded')
        self.source.seek(self.start + self.position)
        value = self.source.read(count)
        self.remaining -= len(value)
        self.archive._metadata_budget -= len(value)
        self.position += len(value)
        return value
    def seek(self, offset, whence=0):
        position = offset if whence == 0 else self.position + offset if whence == 1 else self.length + offset if whence == 2 else -1
        if not 0 <= position <= self.length:
            raise ValueError('Invalid seek')
        self.position = position
        return position
    def tell(self):
        return self.position


def details(archive, item, include_cover=True):
    from worker_safety import read_audio_tags
    from mutagen.id3 import ID3
    from mutagen.mp4 import MP4
    from mutagen.flac import FLAC, Picture
    result = {'title': clean(PurePosixPath(item.filename).stem), 'artist': '', 'duration': None, 'cover': None}
    try:
        audio = read_audio_tags(BoundedReader(archive, item))
        if audio is None:
            return result
        tags = audio.tags or {}
        def first(key):
            value = tags.get(key, [])
            if hasattr(value, 'text'):
                value = value.text
            return clean(value[0]) if value else ''
        title_key, artist_key = ('\xa9nam', '\xa9ART') if isinstance(audio, MP4) else ('TIT2', 'TPE1') if isinstance(audio.tags, ID3) else ('title', 'artist')
        result.update(title=first(title_key) or result['title'], artist=first(artist_key))
        duration = getattr(audio.info, 'length', None)
        if isinstance(duration, (int, float)) and math.isfinite(duration) and 0 < duration <= 7 * 86400:
            result['duration'] = round(duration)
        if not include_cover:
            return result
        image = None
        if isinstance(audio, FLAC) and audio.pictures:
            image = audio.pictures[0].data
        elif isinstance(audio.tags, ID3) and audio.tags.getall('APIC'):
            image = audio.tags.getall('APIC')[0].data
        elif isinstance(audio, MP4) and tags.get('covr'):
            image = bytes(tags['covr'][0])
        elif tags.get('metadata_block_picture'):
            value = tags['metadata_block_picture'][0]
            if len(value) < 3 * 1024**2:
                image = Picture(base64.b64decode(value, validate=True)).data
        elif tags.get('Cover Art (Front)'):
            image = bytes(tags['Cover Art (Front)']).split(b'\0', 1)[-1]
        if image and len(image) <= 2 * 1024**2 and (image.startswith(b'\xff\xd8\xff') or image.startswith(b'\x89PNG\r\n\x1a\n')):
            converted = subprocess.run(['ffmpeg', '-v', 'error', '-threads', '1', '-filter_threads', '1', '-protocol_whitelist', 'pipe',
                '-i', 'pipe:0', '-vf', 'scale=480:480:force_original_aspect_ratio=decrease', '-frames:v', '1',
                '-f', 'image2pipe', '-c:v', 'mjpeg', '-threads', '1', 'pipe:1'], input=image, capture_output=True, timeout=5)
            if converted.returncode == 0 and len(converted.stdout) <= 128 * 1024 and converted.stdout.startswith(b'\xff\xd8\xff'):
                result['cover'] = base64.b64encode(converted.stdout).decode()
    except Exception:
        pass  # Metadata is optional; no provider response or parser text is exposed.
    return result


def inspect(path):
    with zipfile.ZipFile(path) as archive:
        entries = members(archive)
        preview = None
        artists = []
        durations = []
        for _, item in entries:
            value = details(archive, item, include_cover=preview is None or not preview.get('cover'))
            preview = value if preview is None else {**preview, 'cover': preview.get('cover') or value.get('cover')}
            if value['artist'] and value['artist'] not in artists and len(artists) < 10:
                artists.append(value['artist'])
            durations.append(value['duration'])
        return {'title': (preview or {}).get('title', ''), 'artist': clean(', '.join(artists)),
                'duration': sum(durations) if durations and all(value is not None for value in durations) else None,
                'tracks': len(entries), 'cover': (preview or {}).get('cover')}


def playlist(path):
    with zipfile.ZipFile(path) as archive:
        result = []
        for index, (_, item) in enumerate(members(archive)):
            value = details(archive, item, include_cover=False)
            result.append({'id': index, 'title': value['title'], 'artist': value['artist'], 'duration': value['duration']})
        return result


def audio_preview(path, index):
    import tempfile
    import shutil
    formats = {'.flac': 'flac', '.mp3': 'mp3', '.m4a': 'mov', '.ogg': 'ogg', '.opus': 'ogg',
               '.ape': 'ape', '.tta': 'tta', '.dsf': 'dsf', '.wav': 'wav', '.aif': 'aiff', '.aiff': 'aiff'}
    with zipfile.ZipFile(path) as archive:
        entries = members(archive)
        if not 0 <= index < len(entries):
            raise ValueError('Unknown track')
        item = entries[index][1]
        if item.file_size > 512 * 1024**2:
            raise ValueError('Preview input too large')
        # An anonymous seekable file supports MP4/APE/DSD without extracting a
        # user-controlled path. It is unlinked automatically, including on kill.
        with tempfile.TemporaryFile() as source:
            with archive.open(item) as member:
                shutil.copyfileobj(member, source, length=1024 * 1024)
            source.flush()
            source.seek(0)
            fmt = formats[PurePosixPath(item.filename).suffix.lower()]
            options = ['-enable_drefs', '0', '-use_absolute_path', '0'] if fmt == 'mov' else []
            command = ['ffmpeg', '-v', 'error', '-nostdin', '-threads', '1', '-filter_threads', '1',
                       '-protocol_whitelist', 'file,pipe', '-format_whitelist', fmt, '-f', fmt, *options,
                       '-i', '/proc/self/fd/' + str(source.fileno()), '-map', '0:a:0', '-t', '60',
                       '-vn', '-sn', '-dn', '-map_metadata', '-1', '-ac', '2', '-ar', '44100',
                       '-c:a', 'libmp3lame', '-b:a', '128k', '-threads', '1', '-f', 'mp3', 'pipe:1']
            result = subprocess.run(command, pass_fds=(source.fileno(),), capture_output=True, timeout=20)
            if result.returncode or not result.stdout or len(result.stdout) > 2 * 1024**2:
                raise ValueError('Preview unavailable')
            return result.stdout


if __name__ == '__main__':
    from worker_safety import limit_upload_resources
    try:
        limit_upload_resources()
        mode = sys.argv[2] if len(sys.argv) > 2 else 'inspect'
        if mode == 'audio':
            sys.stdout.buffer.write(audio_preview(sys.argv[1], int(sys.argv[3])))
        else:
            value = playlist(sys.argv[1]) if mode == 'tracks' else inspect(sys.argv[1])
            print(json.dumps(value))
    except Exception:
        if len(sys.argv) < 3 or sys.argv[2] != 'audio':
            print('{"error":"unavailable"}')
        raise SystemExit(1)
