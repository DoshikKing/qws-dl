// Narrow command-line adapter for the BSD-licensed Monkey's Audio SDK.
#include <cstdlib>
#include <MAC/All.h>
#include <MAC/MACLib.h>

int main(int argc, char **argv) {
    if (argc != 4) return 2;
    char *end = nullptr;
    const long level = std::strtol(argv[3], &end, 10);
    if (*end || level < 1000 || level > 5000 || level % 1000) return 2;
    if (CompressFile(argv[1], argv[2], static_cast<int>(level)) != 0) return 1;
    return VerifyFile(argv[2], nullptr, nullptr, nullptr) == 0 ? 0 : 1;
}
