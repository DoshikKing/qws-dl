"""Create a cached ZIP64 archive without following links or recompressing audio."""
import os
from pathlib import Path
import sys
import zipfile


def create_archive(directory):
    root = Path(directory).resolve(strict=True)
    target = root / '.qws-archive.zip'
    temporary = root / '.qws-archive.zip.tmp'
    count = 0
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_STORED, allowZip64=True, strict_timestamps=False) as archive:
            for folder, directories, files in os.walk(root, followlinks=False):
                directories[:] = [name for name in directories if not Path(folder, name).is_symlink()]
                for name in files:
                    path = Path(folder, name)
                    if name.startswith('.qws-') or path.is_symlink() or not path.is_file():
                        continue
                    archive.write(path, path.relative_to(root).as_posix())
                    count += 1
        if not count:
            raise ValueError('No downloaded files')
        os.replace(temporary, target)
        return target
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        create_archive(sys.argv[1])
    except (OSError, ValueError, zipfile.BadZipFile):
        print('Unable to archive downloaded files', file=sys.stderr)
        raise SystemExit(1)
