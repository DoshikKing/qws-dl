"""Tag one uploaded track; no Qobuz access and no user-controlled URLs."""
import json
import math
import os
from pathlib import Path
import sys

import mutagen
from mutagen.flac import FLAC
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4
from mutagen.oggopus import OggOpus
from mutagen.oggvorbis import OggVorbis

from lyrics import lookup, metadata, tag_audio
from worker_safety import install_network_safety


def process_upload(directory, filename, cache_path, overrides):
    root = Path(directory).resolve(strict=True)
    path = root / filename
    if path.is_symlink() or path.parent != root or not path.is_file():
        return 6
    try:
        audio = mutagen.File(path)
        if not isinstance(audio, (FLAC, MP3, MP4, OggVorbis, OggOpus)):
            return 6
        # A renamed executable or a different container is not accepted as audio.
        expected = {FLAC: {'.flac'}, MP3: {'.mp3'}, MP4: {'.m4a'},
                    OggVorbis: {'.ogg'}, OggOpus: {'.opus', '.ogg'}}
        if path.suffix.lower() not in expected[type(audio)]:
            return 6
        artist, title, album = metadata(audio)
        artist, title, album = (overrides.get(key) or value for key, value in
                                [('artist', artist), ('title', title), ('album', album)])
        if not artist or not title or max(map(len, (artist, title, album))) > 500:
            return 5
        duration = audio.info.length
        if not math.isfinite(duration) or duration <= 0:
            return 6
    except (mutagen.MutagenError, ValueError, TypeError, KeyError, OSError):
        return 6
    try:
        lyrics = lookup(artist, title, album, round(duration, 3), cache_path)
    except Exception:
        return 7
    if not lyrics:
        return 4
    # The local original remains with its owner; failure deletes this server copy.
    tag_audio(audio, lyrics)
    path.with_suffix('.lrc').write_text((lyrics['lrc'] or lyrics['plain']) + '\n', encoding='utf-8')
    print('Синхронизированный текст добавлен.' if lyrics['lrc'] else
          'Добавлен обычный текст. Файл .lrc без временных меток.', flush=True)
    return 0


if __name__ == '__main__':
    os.umask(0o077)
    install_network_safety()
    try:
        raise SystemExit(process_upload(*sys.argv[1:4], json.loads(sys.argv[4])))
    except Exception:
        print('Не удалось обработать аудиофайл.', file=sys.stderr)
        raise SystemExit(1)
