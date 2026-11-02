import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import mutagen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('process_upload', ROOT / 'scripts/process-upload.py')
upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload)
from archive import create_archive


@unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg required')
class UploadTest(unittest.TestCase):
    def test_formats_synced_plain_tags_pcm_and_exact_zip_contents(self):
        for suffix, codec in [('flac', 'flac'), ('mp3', 'libmp3lame'), ('m4a', 'aac'), ('ogg', 'libvorbis'), ('opus', 'libopus')]:
            for synced in (True, False):
                with self.subTest(suffix=suffix, synced=synced), tempfile.TemporaryDirectory() as directory:
                    path = Path(directory, f'Песня.{suffix}')
                    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
                                    '-c:a', codec, '-metadata', 'artist=Артист', '-metadata', 'title=Песня', str(path)], check=True)
                    audio_hash = lambda: subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'hash', '-hash', 'sha256', '-'])
                    before = audio_hash()
                    lyrics = {'plain': 'Текст', 'lrc': '[00:00.500]Текст' if synced else '',
                              'lines': [('Текст', 500)] if synced else []}
                    with patch.object(upload, 'lookup', return_value=lyrics) as lookup:
                        self.assertEqual(upload.process_upload(directory, path.name, '', {}), 0)
                        self.assertEqual(lookup.call_args.args[0:3], ('Артист', 'Песня', ''))
                    self.assertEqual(before, audio_hash())
                    tags = mutagen.File(path).tags
                    if suffix == 'mp3': self.assertEqual(tags.getall('USLT')[0].text, 'Текст')
                    elif suffix == 'm4a': self.assertEqual(tags['\xa9lyr'], ['Текст'])
                    else: self.assertEqual(tags['LYRICS'], ['Текст'])
                    lrc = Path(directory, 'Песня.lrc')
                    self.assertEqual(lrc.read_text(), (lyrics['lrc'] or 'Текст') + '\n')
                    with zipfile.ZipFile(create_archive(directory)) as archive:
                        self.assertEqual(set(archive.namelist()), {path.name, 'Песня.lrc'})

    def test_invalid_missing_metadata_miss_network_and_overrides(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'song.flac'
            path.write_bytes(b'not audio')
            self.assertEqual(upload.process_upload(directory, path.name, '', {}), 6)
            path.unlink()
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=2', str(path)], check=True)
            self.assertEqual(upload.process_upload(directory, path.name, '', {}), 5)
            overrides = {'artist': 'Исполнитель', 'title': 'Название', 'album': 'Альбом'}
            with patch.object(upload, 'lookup', return_value=None) as lookup:
                self.assertEqual(upload.process_upload(directory, path.name, '', overrides), 4)
                self.assertEqual(lookup.call_args.args[:3], tuple(overrides.values()))
            with patch.object(upload, 'lookup', side_effect=TimeoutError):
                self.assertEqual(upload.process_upload(directory, path.name, '', overrides), 7)
            (root / 'link.flac').symlink_to(path)
            self.assertEqual(upload.process_upload(directory, 'link.flac', '', overrides), 6)
            path.rename(root / 'wrong.mp3')
            self.assertEqual(upload.process_upload(directory, 'wrong.mp3', '', overrides), 6)
