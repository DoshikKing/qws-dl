"""Verify a ZIP64 archive, then remove its source files without following links."""
import os
from pathlib import Path
import shutil
import sys
import zipfile


def verify_archive(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError('Archive is missing or is a link')
    with zipfile.ZipFile(path) as archive:
        if not archive.namelist() or archive.testzip() is not None:
            raise ValueError('Archive verification failed')


def create_archive(directory):
    root = Path(directory).resolve(strict=True)
    target = root / '.qws-archive.zip'
    temporary = root / '.qws-archive.zip.tmp'
    committed = root / '.qws-archive.commit'
    sources = []
    try:
        # The marker survives interrupted cleanup: never rebuild a full ZIP from
        # only the remaining subset of sources after some originals were removed.
        if not committed.exists():
            for folder, directories, files in os.walk(root, followlinks=False):
                directories[:] = [name for name in directories if not name.startswith('.qws-') and not Path(folder, name).is_symlink()]
                for name in files:
                    path = Path(folder, name)
                    if not name.startswith('.qws-') and not path.is_symlink() and path.is_file():
                        sources.append(path)
            if sources:
                temporary.unlink(missing_ok=True)
                with zipfile.ZipFile(temporary, 'x', compression=zipfile.ZIP_STORED, allowZip64=True, strict_timestamps=False) as archive:
                    for path in sources:
                        archive.write(path, path.relative_to(root).as_posix())
                verify_archive(temporary)
                os.replace(temporary, target)
                committed.touch()
            elif not target.exists():
                raise ValueError('No downloaded files')
        verify_archive(target)
        for entry in root.iterdir():
            if entry in (target, committed):
                continue
            if entry.is_dir() and not entry.is_symlink():
                shutil.rmtree(entry)
            else:
                entry.unlink()
        committed.unlink(missing_ok=True)
        return target
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        create_archive(sys.argv[1])
    except (OSError, ValueError, zipfile.BadZipFile):
        print('Unable to archive downloaded files', file=sys.stderr)
        raise SystemExit(1)
