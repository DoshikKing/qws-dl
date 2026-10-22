import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from archive import create_archive


class ArchiveTest(unittest.TestCase):
    def test_zip_preserves_unicode_and_contents_then_removes_sources_and_links(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / 'download'
            (root / 'Альбом').mkdir(parents=True)
            (root / 'Альбом/01. Трек.flac').write_bytes(b'audio')
            (root / 'cover.jpg').write_bytes(b'cover')
            (root / '.qws-metadata.json').write_text('{"title":"metadata"}')
            (base / 'private').write_text('private')
            (root / 'leak.flac').symlink_to(base / 'private')
            (root / 'outside').symlink_to(base, target_is_directory=True)
            for _ in range(2):
                path = create_archive(root)
                with zipfile.ZipFile(path) as archive:
                    self.assertEqual(set(archive.namelist()), {'Альбом/01. Трек.flac', 'cover.jpg'})
                    self.assertEqual(archive.read('Альбом/01. Трек.flac'), b'audio')
                    self.assertIsNone(archive.testzip())
                self.assertEqual(list(root.iterdir()), [path])
                self.assertEqual((base / 'private').read_text(), 'private')

    def test_verification_failure_keeps_originals(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'song.flac'
            source.write_bytes(b'audio')
            with patch('archive.verify_archive', side_effect=ValueError('CRC failure')):
                with self.assertRaises(ValueError):
                    create_archive(root)
            self.assertEqual(source.read_bytes(), b'audio')
            self.assertFalse((root / '.qws-archive.zip').exists())
            self.assertFalse((root / '.qws-archive.zip.tmp').exists())

    def test_interrupted_cleanup_never_rebuilds_full_archive_from_remaining_subset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'one.flac').write_bytes(b'one')
            (root / 'two.flac').write_bytes(b'two')
            unlink = Path.unlink
            deleted = []

            def fail_on_second(path, *args, **kwargs):
                if path.suffix == '.flac' and deleted:
                    raise PermissionError('Interrupted cleanup')
                result = unlink(path, *args, **kwargs)
                if path.suffix == '.flac':
                    deleted.append(path.name)
                return result

            with patch.object(Path, 'unlink', fail_on_second):
                with self.assertRaises(PermissionError):
                    create_archive(root)
            self.assertEqual(len(deleted), 1)
            self.assertEqual(len(list(root.glob('*.flac'))), 1)
            self.assertTrue((root / '.qws-archive.commit').exists())
            path = create_archive(root)
            with zipfile.ZipFile(path) as archive:
                self.assertEqual({name: archive.read(name) for name in archive.namelist()}, {'one.flac': b'one', 'two.flac': b'two'})
            self.assertEqual(list(root.iterdir()), [path])

    def test_corrupt_committed_archive_never_deletes_remaining_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'song.flac').write_bytes(b'audio')
            (root / '.qws-archive.zip').write_bytes(b'corrupt')
            (root / '.qws-archive.commit').touch()
            with self.assertRaises(zipfile.BadZipFile):
                create_archive(root)
            self.assertEqual((root / 'song.flac').read_bytes(), b'audio')

    def test_legacy_cached_zip_is_rebuilt_before_sources_are_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'one.flac').write_bytes(b'one')
            (root / 'two.flac').write_bytes(b'two')
            with zipfile.ZipFile(root / '.qws-archive.zip', 'w') as archive:
                archive.writestr('one.flac', b'one')
            path = create_archive(root)
            with zipfile.ZipFile(path) as archive:
                self.assertEqual({name: archive.read(name) for name in archive.namelist()}, {'one.flac': b'one', 'two.flac': b'two'})
            self.assertEqual(list(root.iterdir()), [path])

    def test_no_files_leaves_no_empty_zip_or_temporary_file(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                create_archive(directory)
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == '__main__':
    unittest.main()
