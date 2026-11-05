// A deliberately bounded sketch surface. The worker has no general filesystem includes,
// inline assembly, pragmas or dynamically installed libraries. Container limits are still required.
const HEADERS = new Set(['Arduino.h', 'Wire.h', 'SPI.h', 'EEPROM.h', 'Servo.h', 'Stepper.h', 'LiquidCrystal.h', 'math.h', 'stdint.h', 'stdlib.h', 'string.h', 'limits.h']);
// Lex comments rather than using a regexp: comment markers inside C++ strings must
// not be able to hide a real preprocessor directive from the policy.
function withoutComments(source) {
  let out = '', i = 0;
  while (i < source.length) {
    if (source.startsWith('//', i)) {
      while (i < source.length && source[i] !== '\n') { out += ' '; i++; }
    } else if (source.startsWith('/*', i)) {
      out += '  '; i += 2;
      while (i < source.length && !source.startsWith('*/', i)) { out += source[i] === '\n' ? '\n' : ' '; i++; }
      if (i < source.length) { out += '  '; i += 2; }
    } else if (source.startsWith('R"', i)) {
      const opening = source.indexOf('(', i + 2);
      if (opening < 0 || opening - i > 18) throw new Error('Invalid raw string delimiter.');
      const ending = `)${source.slice(i + 2, opening)}"`;
      const end = source.indexOf(ending, opening + 1);
      if (end < 0) throw new Error('Unterminated raw string.');
      out += source.slice(i, end + ending.length); i = end + ending.length;
    } else if (source[i] === '"' || source[i] === "'") {
      const quote = source[i]; out += source[i++];
      while (i < source.length) {
        const char = source[i++]; out += char;
        if (char === '\\' && i < source.length) out += source[i++];
        else if (char === quote) break;
      }
    } else out += source[i++];
  }
  return out;
}
export function validateSketch(code) {
  const logical = withoutComments(code.replace(/\\[ \t]*\r?\n/g, ''));
  if (/\b(?:asm|__asm|__asm__|_Pragma|__has_include|__has_include_next)\b|##|%:|\?\?[=/!'()<>-]/.test(logical)) throw new Error('Inline assembly, token-pasting macros, dynamic includes, pragmas and alternative preprocessor tokens are not supported by the hosted compiler.');
  for (const line of logical.split(/\r?\n/)) {
    const directive = line.match(/^\s*#\s*([a-zA-Z_]*)\b(.*)$/);
    if (!directive) continue;
    const [, name, value] = directive;
    if (name === 'include') {
      const header = value.trim().match(/^(?:<([^<>]+)>|"([^"\r\n]+)")$/);
      if (!header || !HEADERS.has(header[1] || header[2])) throw new Error('Unsupported include. Available: Arduino, Wire, SPI, EEPROM, Servo, Stepper, LiquidCrystal and standard C math/string headers.');
    } else if (!['define', 'undef', 'if', 'ifdef', 'ifndef', 'elif', 'else', 'endif', 'error', 'warning'].includes(name)) {
      throw new Error(`Unsupported preprocessor directive: ${name}`);
    }
  }
}
