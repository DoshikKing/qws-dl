import base64
import json
import struct
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import mutagen
from mutagen.flac import FLAC, Picture
from mutagen.id3 import ID3
from mutagen.mp4 import MP4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import convert_audio as conversion
from lyrics import metadata, enrich_downloads
from archive import create_archive

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')


def source(root, bits=24):
    path = Path(root) / '01. Артист - Песня.flac'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=0.5', '-ar', '96000', '-ac', '2',
                    '-c:a', 'flac', '-sample_fmt', 's16' if bits == 16 else 's32', str(path)], check=True)
    audio = FLAC(path)
    audio.update(title='Песня', artist='Артист', album='Альбом', albumartist='Артист', tracknumber='1/9',
                 discnumber='1/2', date='2024', lyrics='Первая\nВторая', syncedlyrics='[00:00.000]Первая\n[00:00.250]Вторая')
    cover = Picture(); cover.data = PNG; cover.mime = 'image/png'; cover.type = 3; audio.add_picture(cover); audio.save()
    path.with_suffix('.lrc').write_text('[00:00.000]Первая\n[00:00.250]Вторая\n')
    return path


def pcm(path):
    return subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:a:0', '-f', 's24le', '-c:a', 'pcm_s24le', '-'])


class ConversionTest(unittest.TestCase):
    def test_eight_real_formats_tags_artwork_lyrics_sidecar_and_lossless_pcm(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'MIN_FREE_BYTES': '0'}):
            for fmt, (suffix, codec, _) in conversion.PROFILES.items():
                with self.subTest(format=fmt):
                    conversion.ensure_encoder(fmt)
                    root = Path(directory) / fmt; root.mkdir()
                    original = source(root); original_pcm = pcm(original)
                    conversion.convert_downloads(root, fmt)
                    output = original.with_suffix(suffix)
                    self.assertFalse(original.exists())
                    info, length = conversion.probe(output)
                    self.assertEqual(info['codec_name'], codec)
                    self.assertLess(abs(length - 0.5), 0.05)
                    audio = mutagen.File(output)
                    self.assertEqual(metadata(audio), ('Артист', 'Песня', 'Альбом'))
                    if isinstance(audio.tags, ID3):
                        self.assertEqual(audio.tags.getall('APIC')[0].data, PNG)
                        self.assertIn('Первая', audio.tags.getall('USLT')[0].text)
                        self.assertEqual(audio.tags.getall('SYLT')[0].text[1], ('Вторая', 250))
                    elif isinstance(audio, MP4):
                        self.assertEqual(bytes(audio['covr'][0]), PNG)
                        self.assertIn('Первая', audio['\xa9lyr'][0])
                        self.assertEqual(audio['trkn'][0], (1, 9))
                    elif fmt == 'ape':
                        self.assertEqual(bytes(audio['Cover Art (Front)']).split(b'\0', 1)[1], PNG)
                        self.assertIn('Первая', str(audio['LYRICS']))
                    else:
                        self.assertEqual(Picture(base64.b64decode(audio['metadata_block_picture'][0])).data, PNG)
                        self.assertIn('Первая', audio['LYRICS'][0])
                    self.assertIn('[00:00.250]', output.with_suffix('.lrc').read_text())
                    if fmt in {'alac', 'ape', 'tta'}:
                        self.assertEqual(pcm(output), original_pcm)
                    conversion.convert_downloads(root, fmt)  # A requested profile also applies to an already matching codec.
                    self.assertEqual(len(list(root.glob('*' + suffix))), 1)
                    self.assertFalse(list(root.glob('.qws-convert-*')))

    def test_16bit_lossless_and_enrichment_for_ape_dsf_tta(self):
        lyrics = {'plain': 'Новый текст', 'lrc': '[00:00.000]Новый текст', 'lines': [('Новый текст', 0)]}
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'MIN_FREE_BYTES': '0'}):
            for fmt in ['ape', 'alac', 'tta', 'dsd']:
                with self.subTest(format=fmt):
                    root = Path(directory) / fmt; root.mkdir(); original = source(root, 16); before = pcm(original)
                    conversion.convert_downloads(root, fmt); output = original.with_suffix(conversion.PROFILES[fmt][0])
                    if fmt != 'dsd': self.assertEqual(pcm(output), before)
                    with patch('lyrics.lookup', return_value=lyrics): enrich_downloads(root)
                    audio = mutagen.File(output)
                    text = audio.tags.getall('USLT')[0].text if isinstance(audio.tags, ID3) else str(audio['\xa9lyr' if isinstance(audio, MP4) else 'LYRICS'][0])
                    self.assertEqual(text, 'Новый текст')
                    self.assertIn('Новый текст', output.with_suffix('.lrc').read_text())
                    archive = create_archive(root)
                    import zipfile
                    with zipfile.ZipFile(archive) as zip:
                        self.assertIn(output.name, zip.namelist()); self.assertIn(output.with_suffix('.lrc').name, zip.namelist())

    def test_custom_profiles_change_real_bitrate_depth_rate_compression_and_dsd(self):
        cases = [('mp3', {'bitrate': 128, 'sampleRate': 44100}), ('mp3', {'mode': 'vbr', 'quality': 0}),
                 ('mp3', {'mode': 'vbr', 'quality': 9}), ('aac', {'bitrate': 96, 'sampleRate': 32000}),
                 ('aac', {'bitrate': 320, 'sampleRate': 96000}), ('vorbis', {'quality': 0, 'sampleRate': 32000}),
                 ('vorbis', {'quality': 10}), ('opus', {'bitrate': 64, 'mode': 'cbr', 'compression': 0}),
                 ('opus', {'bitrate': 256, 'mode': 'cvbr', 'compression': 10}),
                 *[('ape', {'compression': level, 'bitDepth': 16, 'sampleRate': 44100}) for level in [1000, 2000, 3000, 4000, 5000]],
                 ('alac', {'bitDepth': 16, 'sampleRate': 48000}), ('alac', {'bitDepth': 24, 'sampleRate': 192000}),
                 ('tta', {'bitDepth': 16, 'sampleRate': 44100}), ('tta', {'bitDepth': 24, 'sampleRate': 96000}),
                 ('tta', {'bitDepth': 24, 'sampleRate': 176400}),
                 ('dsd', {'dsdRate': 5644800, 'headroom': 3}), ('dsd', {'dsdRate': 11289600, 'headroom': 12})]
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'MIN_FREE_BYTES': '0'}):
            for index, (fmt, options) in enumerate(cases):
                with self.subTest(format=fmt, options=options):
                    root = Path(directory) / str(index); root.mkdir(); original = source(root)
                    conversion.convert_downloads(root, fmt, options)
                    output = original.with_suffix(conversion.PROFILES[fmt][0]); info, _ = conversion.probe(output)
                    self.assertEqual(metadata(mutagen.File(output)), ('Артист', 'Песня', 'Альбом'))
                    if options.get('sampleRate'): self.assertEqual(int(info['sample_rate']), options['sampleRate'])
                    if options.get('bitDepth'): self.assertEqual(int(info['bits_per_raw_sample']), options['bitDepth'])
                    if fmt == 'mp3' and options.get('bitrate'): self.assertEqual(int(info['bit_rate']), options['bitrate'] * 1000)
                    if fmt == 'ape':
                        data = output.read_bytes(); descriptor = struct.unpack_from('<I', data, 8)[0]
                        self.assertEqual(struct.unpack_from('<H', data, descriptor)[0], options['compression'])
                    if fmt == 'opus' and options.get('mode') == 'cbr':
                        packets = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'packet=size', '-of', 'json', str(output)]))['packets']
                        self.assertEqual({int(packet['size']) for packet in packets}, {160})
                    if fmt == 'dsd': self.assertEqual(mutagen.File(output).info.sample_rate, options['dsdRate'])
                    if fmt == 'mp3' and options.get('bitrate'):
                        # Matching input codec must still honor a newly chosen bitrate/rate.
                        conversion.convert_downloads(root, fmt, {'bitrate': 192, 'sampleRate': 48000})
                        changed, _ = conversion.probe(output)
                        self.assertEqual(int(changed['bit_rate']), 192000); self.assertEqual(int(changed['sample_rate']), 48000)

    def test_settings_boundary_rejects_types_unknown_fields_and_other_format_controls(self):
        for fmt, bad in [('original', {'bitrate': 128}), ('mp3', {'bitDepth': 24}), ('alac', {'bitrate': 192}),
                         ('mp3', {'bitrate': '128'}), ('mp3', {'bitrate': True}), ('mp3', {'sampleRate': 192000}),
                         ('vorbis', {'quality': 11}), ('opus', {'compression': -1}), ('ape', {'compression': 9999}),
                         ('alac', {'bitDepth': 32}), ('tta', {'bitDepth': 32}), ('dsd', {'dsdRate': 999999999}), ('tta', {'extra_args': '-y'}),
                         ('aac', []), ('aac', None), ('aac', {'bitrate': 256.0})]:
            with self.subTest(format=fmt, bad=bad), self.assertRaises(conversion.ConversionError):
                conversion.normalize_options(fmt, bad)
        self.assertEqual(conversion.normalize_options('mp3', {})['bitrate'], 320)
        for fmt in conversion.PROFILES:
            defaults = conversion.normalize_options(fmt, {})
            self.assertEqual(conversion.normalize_options(fmt, defaults), defaults)

    def test_failure_collision_space_limit_links_and_invalid_format_preserve_source(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'MIN_FREE_BYTES': '0'}):
            root = Path(directory); original = source(root); before = original.read_bytes()
            with self.assertRaises(conversion.ConversionError): conversion.convert_downloads(root, 'mp3;touch /tmp/not-allowed')
            with patch('convert_audio.run', side_effect=conversion.ConversionError('fixture')):
                with self.assertRaises(conversion.ConversionError): conversion.convert_downloads(root, 'opus')
            self.assertEqual(original.read_bytes(), before); self.assertFalse(list(root.glob('.qws-convert-*')))
            target = original.with_suffix('.mp3'); target.write_bytes(b'keep')
            with self.assertRaises(conversion.ConversionError): conversion.convert_downloads(root, 'mp3')
            self.assertEqual(target.read_bytes(), b'keep'); target.unlink()
            with patch.dict(os.environ, {'MAX_JOB_BYTES': '1'}):
                with self.assertRaises(conversion.ConversionError): conversion.convert_downloads(root, 'mp3')
            self.assertEqual(original.read_bytes(), before)
            original.rename(root / '.qws-hidden.flac')
            (root / 'linked.flac').symlink_to(root / '.qws-hidden.flac')
            conversion.convert_downloads(root, 'mp3')
            self.assertTrue((root / 'linked.flac').is_symlink()); self.assertFalse((root / 'linked.mp3').exists())

    def test_missing_encoder_fails_before_download_and_original_requires_no_tools(self):
        with patch('convert_audio.encoder', return_value=None):
            conversion.ensure_encoder('original')
            with self.assertRaises(conversion.ConversionError): conversion.ensure_encoder('dsd')


if __name__ == '__main__': unittest.main()
