// Narrow command-line adapter for the BSD-licensed Monkey's Audio SDK.
#include <MAC/All.h>
#include <MAC/MACLib.h>

int main(int argc, char **argv) {
    if (argc != 3) return 2;
    if (CompressFile(argv[1], argv[2], APE_COMPRESSION_LEVEL_NORMAL) != 0) return 1;
    return VerifyFile(argv[2], nullptr, nullptr, nullptr) == 0 ? 0 : 1;
}
