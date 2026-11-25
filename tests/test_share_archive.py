import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile
from mutagen.flac import FLAC, Picture
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from share_archive import inspect

class ShareArchiveTest(unittest.TestCase):
    def test_preview_reads_only_audio_and_never_extracts_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            track=root/'track.flac'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=duration=2',str(track)],check=True)
            cover=root/'cover.jpg'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=blue:s=32x32','-frames:v','1','-threads','1',str(cover)],check=True)
            audio=FLAC(track);audio['title']=['<script>unsafe</script>'];audio['artist']=['Fixture artist']
            picture=Picture();picture.type=3;picture.mime='image/jpeg';picture.data=cover.read_bytes();audio.add_picture(picture);audio.save()
            archive=root/'archive.zip'
            with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_STORED) as zipped:
                zipped.write(track,'album/song.flac');zipped.writestr('../private.flac',track.read_bytes());zipped.writestr('.qws-secret.flac',track.read_bytes());zipped.writestr('session.json','private-token')
            value=inspect(archive)
            self.assertEqual(value['tracks'],1);self.assertEqual(value['duration'],2);self.assertEqual(value['artist'],'Fixture artist')
            self.assertEqual(value['title'],'<script>unsafe</script>')  # Vue must escape text, never render HTML.
            self.assertIsNotNone(value['cover']);self.assertLess(len(value['cover']),180000)
            self.assertNotIn('private-token',json.dumps(value));self.assertFalse((root/'album').exists())
            with zipfile.ZipFile(root/'compressed.zip','w',compression=zipfile.ZIP_DEFLATED) as zipped:zipped.write(track,'song.flac')
            self.assertEqual(inspect(root/'compressed.zip')['tracks'],0)

    def test_previews_read_all_supported_output_formats(self):
        from unittest.mock import patch
        import convert_audio as conversion
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {'MIN_FREE_BYTES': '0'}):
            for fmt in conversion.PROFILES:
                with self.subTest(format=fmt):
                    root=Path(directory)/fmt
                    root.mkdir()
                    track=root/'source.flac'
                    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=duration=1',str(track)],check=True)
                    audio=FLAC(track);audio['title']=['Fixture title'];audio['artist']=['Fixture artist'];audio.save()
                    conversion.convert_downloads(root,fmt)
                    with zipfile.ZipFile(root/'archive.zip','w',compression=zipfile.ZIP_STORED) as archive:
                        for value in root.iterdir():
                            if value.suffix!='.zip':archive.write(value,value.name)
                    value=inspect(root/'archive.zip')
                    self.assertEqual(value['title'],'Fixture title')
                    self.assertEqual(value['artist'],'Fixture artist')
                    self.assertEqual(value['duration'],1)
