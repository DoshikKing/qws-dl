import sys
from pathlib import Path
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from archive import create_archive


class ArchiveTest(unittest.TestCase):
    def test_zip_preserves_files_and_unicode_but_excludes_links_and_itself(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / 'download'
            (root / 'Альбом').mkdir(parents=True)
            (root / 'Альбом/01. Трек.flac').write_bytes(b'audio')
            (root / 'cover.jpg').write_bytes(b'cover')
            (root / '.qws-metadata.json').write_text('{"title":"private metadata"}')
            (base / 'private').write_text('private')
            (root / 'leak.flac').symlink_to(base / 'private')
            (root / 'outside').symlink_to(base, target_is_directory=True)
            for _ in range(2):
                path = create_archive(root)
                with zipfile.ZipFile(path) as archive:
                    self.assertEqual(set(archive.namelist()), {'Альбом/01. Трек.flac', 'cover.jpg'})
                    self.assertEqual(archive.read('Альбом/01. Трек.flac'), b'audio')
                    self.assertIsNone(archive.testzip())
                self.assertFalse((root / '.qws-archive.zip.tmp').exists())

    def test_no_files_leaves_no_empty_zip_or_temporary_file(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                create_archive(directory)
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == '__main__':
    unittest.main()
