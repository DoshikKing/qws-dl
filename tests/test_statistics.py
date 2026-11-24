import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile
from mutagen.flac import FLAC

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from archive import create_archive, audio_statistics


class StatisticsTest(unittest.TestCase):
    def test_only_real_audio_is_counted_and_first_genre_survives_source_removal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, genre in [('one.flac', ['Rock', 'Alternative']), ('two.flac', ['Rock']), ('three.flac', [])]:
                path = root / name
                subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=0.1', str(path)], check=True)
                audio = FLAC(path)
                if genre:
                    audio['genre'] = genre
                audio.save()
            (root / 'broken.flac').write_bytes(b'incomplete audio')
            (root / 'lyrics.lrc').write_text('[00:01]not an audio track')
            (root / 'cover.jpg').write_bytes(b'image')
            report = audio_statistics(list(root.iterdir()))
            self.assertEqual(report['tracks'], 3)
            self.assertEqual({item['name']: item['count'] for item in report['genres']}, {'Rock': 2, 'Без жанра': 1})
            archive = create_archive(root)
            with zipfile.ZipFile(archive) as zipped:
                self.assertEqual(json.loads(zipped.comment), report)
                self.assertFalse(any(name.startswith('.qws-') for name in zipped.namelist()))
            self.assertEqual(list(root.iterdir()), [archive])
            create_archive(root)
            with zipfile.ZipFile(archive) as zipped:
                self.assertEqual(json.loads(zipped.comment), report)

    def test_genres_survive_all_supported_converted_formats(self):
        import convert_audio as conversion
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {'MIN_FREE_BYTES': '0'}):
            for fmt in conversion.PROFILES:
                with self.subTest(format=fmt):
                    root = Path(directory) / fmt
                    root.mkdir()
                    path = root / 'fixture.flac'
                    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=0.2', str(path)], check=True)
                    audio = FLAC(path)
                    audio['genre'] = ['Rock']
                    audio.save()
                    conversion.convert_downloads(root, fmt)
                    self.assertEqual(audio_statistics(list(root.iterdir())),
                        {'version': 1, 'tracks': 1, 'genres': [{'name': 'Rock', 'count': 1}]})
