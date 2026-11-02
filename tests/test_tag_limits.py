import importlib.util
import json
from pathlib import Path
import resource
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zlib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from worker_safety import install_tag_safety, MetadataLimitError
from mutagen.id3 import ID3, _frames
spec = importlib.util.spec_from_file_location('upload_limits_fixture', ROOT / 'scripts/process-upload.py')
upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload)


def tag(frames, version=3):
    data = b''
    for content in frames:
        payload = struct.pack('>I', len(content)) + zlib.compress(content)
        if version == 3:
            data += b'PRIV' + struct.pack('>I', len(payload)) + b'\0\x80' + payload
        else:
            # ID3v2.4 frame sizes and data-length indicators are syncsafe.
            size = lambda n: bytes((n >> 21 & 127, n >> 14 & 127, n >> 7 & 127, n & 127))
            payload = size(len(content)) + zlib.compress(content)
            data += b'PRIV' + size(len(payload)) + b'\0\x09' + payload
    n = len(data)
    return b'ID3' + bytes([version, 0, 0]) + bytes((n >> 21 & 127, n >> 14 & 127, n >> 7 & 127, n & 127)) + data


class TagLimitTest(unittest.TestCase):
    def test_compressed_frames_are_bounded_individually_and_in_aggregate(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'tags.mp3')
            for version in (3, 4):
                with self.subTest(version=version):
                    path.write_bytes(tag([b'owner\0' + b'A' * 4096], version))
                    with patch.object(_frames, 'zlib', zlib):
                        install_tag_safety(path)
                        self.assertEqual(len(ID3(path).getall('PRIV')[0].data), 4096)
                    path.write_bytes(tag([b'owner\0' + b'A' * (9 * 1024**2)], version))
                    with patch.object(_frames, 'zlib', zlib):
                        install_tag_safety(path)
                        with self.assertRaises(MetadataLimitError): ID3(path)
                    path.write_bytes(tag([bytes([n + 65]) + b'\0' + b'A' * (6 * 1024**2) for n in range(3)], version))
                    with patch.object(_frames, 'zlib', zlib):
                        install_tag_safety(path)
                        with self.assertRaises(MetadataLimitError): ID3(path)
            # Other libraries retain the real zlib API, with no global monkeypatch.
            self.assertEqual(len(zlib.decompress(zlib.compress(b'A' * (9 * 1024**2)))), 9 * 1024**2)
            # A huge advertised ID3 block is refused before reading its body.
            path.write_bytes(b'ID3\x03\0\0\x7f\x7f\x7f\x7f')
            with self.assertRaises(MetadataLimitError): install_tag_safety(path)

    def test_resource_limits_are_installed_only_in_child_and_never_raised(self):
        before = (resource.getrlimit(resource.RLIMIT_AS), resource.getrlimit(resource.RLIMIT_CPU))
        code = "import resource,json,sys;sys.path.insert(0,'scripts');from worker_safety import limit_upload_resources;resource.setrlimit(resource.RLIMIT_AS,(256*1024**2,256*1024**2));limit_upload_resources();print(json.dumps([resource.getrlimit(resource.RLIMIT_AS),resource.getrlimit(resource.RLIMIT_CPU)]))"
        result = json.loads(subprocess.check_output([sys.executable, '-c', code], cwd=ROOT, text=True))
        self.assertEqual(result, [[256*1024**2]*2, [30,30]])
        self.assertEqual(before, (resource.getrlimit(resource.RLIMIT_AS), resource.getrlimit(resource.RLIMIT_CPU)))

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg required for real MP3')
    def test_real_mp3_compression_bomb_is_rejected_before_lookup_by_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'song.mp3')
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=duration=1',str(path)],check=True)
            ID3(path).delete()
            path.write_bytes(tag([b'owner\0' + b'A' * (32 * 1024**2)]) + path.read_bytes())
            self.assertLess(path.stat().st_size, 100000)
            with patch.object(upload, 'lookup', side_effect=AssertionError('lookup must not run')):
                self.assertEqual(upload.process_upload(directory, path.name, '', {}), 8)
            result = subprocess.run([sys.executable,str(ROOT/'scripts/process-upload.py'),directory,path.name,'','{}'],capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,8,result.stderr)
            self.assertFalse(path.with_suffix('.lrc').exists())
