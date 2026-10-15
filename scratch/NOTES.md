Scratch NES Emulator port scaffold.

The TypeScript ROM parser is the reference implementation. The current GoboScript
sprite only checks that the statically embedded ROM list begins with the iNES signature;
the build-time generator defaults to `test_rom.nes` but accepts another local image. The project
also loads a generated numeric port-vector list, but does not execute it yet.
CPU, PPU, APU, mapper, and controller execution are not implemented yet.
