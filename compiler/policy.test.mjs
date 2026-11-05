import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSketch } from './policy.mjs';
test('allows installed headers, macros and normal sketches', () => {
  validateSketch('#include <Servo.h>\n#define PIN 9\nvoid setup() {}\nvoid loop() {}');
});
test('rejects arbitrary filesystem and computed includes', () => {
  for (const code of ['#include "/proc/1/environ"', '#include HEADER', '#include_next <Arduino.h>', '#import "/etc/passwd"', '#inc\\\nlude "/etc/passwd"', '#/**/include "/etc/passwd"']) assert.throws(() => validateSketch(code));
});
test('rejects assembler and alternate preprocessing paths', () => {
  for (const code of ['asm(".incbin /etc/passwd");', '__asm__("...");', '#define JOIN(a,b) a##b\nJOIN(__a,sm__)(".incbin...")', '_Pragma("...")', '%:include "/etc/passwd"', '??=include "/etc/passwd"', '#pragma GCC dependency "/etc/passwd"']) assert.throws(() => validateSketch(code));
});
test('comment-like strings cannot hide filesystem includes', () => {
  for (const code of ['const char* a="/*";\n#include "/proc/1/environ"\n// */', 'const char* a=R"( /* )";\n#include "/etc/passwd"\n// */', '#inc\\  \nlude "/etc/passwd"']) assert.throws(() => validateSketch(code));
  validateSketch('const char* a="http://example.com/*";\n#include <Arduino.h>');
});
