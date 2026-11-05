'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
exports.ReadableException = void 0
class ReadableException extends Error {
  constructor(message, cause) {
    super(message, { cause })
    this.name = 'ReadableException'
  }
}
exports.ReadableException = ReadableException
