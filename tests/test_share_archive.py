import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile
from mutagen.flac import FLAC, Picture
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from share_archive import inspect, playlist, audio_preview

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
            before=archive.read_bytes()
            self.assertEqual(playlist(archive),[{'id':0,'title':'<script>unsafe</script>','artist':'Fixture artist','duration':2}])
            clip=audio_preview(archive,0)
            self.assertGreater(len(clip),1000)
            self.assertNotIn(b'private-token',clip)
            self.assertNotIn(b'Fixture artist',clip)
            self.assertEqual(archive.read_bytes(),before)
            for index in [-1,1,9999]:
                with self.assertRaises(ValueError):audio_preview(archive,index)
            with zipfile.ZipFile(root/'compressed.zip','w',compression=zipfile.ZIP_DEFLATED) as zipped:zipped.write(track,'song.flac')
            self.assertEqual(inspect(root/'compressed.zip')['tracks'],0)
            with self.assertRaises(ValueError):audio_preview(root/'compressed.zip',0)

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
                    clip=audio_preview(root/'archive.zip',0)
                    result=subprocess.run(['ffprobe','-v','error','-show_streams','-of','json','pipe:0'],input=clip,capture_output=True,check=True)
                    self.assertEqual(json.loads(result.stdout)['streams'][0]['codec_name'],'mp3')

    def test_audio_preview_is_capped_and_rejects_disguised_playlists(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);track=root/'long.flac'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=duration=65',str(track)],check=True)
            archive=root/'long.zip'
            with zipfile.ZipFile(archive,'w') as zipped:zipped.write(track,'long.flac')
            clip=root/'clip.mp3';clip.write_bytes(audio_preview(archive,0))
            probe=subprocess.run(['ffprobe','-v','error','-show_format','-of','json',str(clip)],capture_output=True,check=True)
            self.assertLess(float(json.loads(probe.stdout)['format']['duration']),60.1)
            with zipfile.ZipFile(root/'unsafe.zip','w') as zipped:zipped.writestr('disguised.mp3','#EXTM3U\nfile:///etc/passwd')
            with self.assertRaises(ValueError):audio_preview(root/'unsafe.zip',0)
