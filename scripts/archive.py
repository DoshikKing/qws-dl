"""Verify a ZIP64 archive, then remove its source files without following links."""
import os
import json
import re
from collections import Counter
from pathlib import Path
import shutil
import sys
import zipfile


def audio_statistics(sources):
    try:
        from worker_safety import read_audio_tags
        from mutagen.id3 import ID3
        from mutagen.mp4 import MP4
    except ImportError:
        return None  # Standalone archive verification also works without audio dependencies.
    genres = Counter()
    for path in sources:
        if path.suffix.lower() not in {'.flac', '.mp3', '.m4a', '.ogg', '.opus', '.ape', '.tta', '.dsf', '.wav', '.aif', '.aiff'}:
            continue
        try:
            audio = read_audio_tags(path)
            if audio is None or not getattr(audio, 'info', None):
                continue
            tags = audio.tags or {}
            key = '\xa9gen' if isinstance(audio, MP4) else 'TCON' if isinstance(audio.tags, ID3) else 'genre'
            values = tags.get(key, [])
            if hasattr(values, 'text'):
                values = values.text
            # A track belongs to its first genre, so totals never double-count it.
            name = re.sub(r'[\x00-\x1f\x7f]', ' ', str(values[0]) if values else '').strip()[:100]
            name = ' '.join(name.split()) or 'Без жанра'
            if name not in genres and len(genres) >= 127:
                name = 'Другие жанры'
            genres[name] += 1
        except Exception:
            # Invalid/partial media and oversized tags do not become successful tracks.
            continue
    return {'version': 1, 'tracks': sum(genres.values()),
            'genres': [{'name': name, 'count': count} for name, count in genres.items()]}


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
                    statistics = audio_statistics(sources)
                    if statistics is not None:
                        archive.comment = json.dumps(statistics, ensure_ascii=False).encode('utf-8')
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
