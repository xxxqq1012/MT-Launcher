/**
 * OCR 冒烟验证：PP-OCRv4 mobile onnx（det/rec/cls）+ 字典 → PaddleOcrService 推理
 * 用法：node scripts/ocr-smoke.cjs [图片路径]
 * 依赖：pnpm add paddleocr onnxruntime-node pngjs
 */
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')
const ort = require('onnxruntime-node')
const { PaddleOcrService } = require('paddleocr')

function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

async function decodePng(file) {
  const png = PNG.sync.read(fs.readFileSync(file))
  // pngjs data 是 RGBA；运行时归一化会忽略 alpha
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) }
}

async function main() {
  const imgFile = process.argv[2] || path.join(process.env.TEMP, 'ocr_test.png')
  const modelsDir = path.join(process.cwd(), 'internal-plugins', 'screen-ocr', 'models')

  const [detBuf, recBuf, clsBuf, dictText] = await Promise.all([
    fs.promises.readFile(path.join(modelsDir, 'det.onnx')),
    fs.promises.readFile(path.join(modelsDir, 'rec.onnx')),
    fs.promises.readFile(path.join(modelsDir, 'cls.onnx')),
    fs.promises.readFile(path.join(modelsDir, 'ppocr_keys_v1.txt'), 'utf8')
  ])

  console.log('创建 OCR 服务实例...')
  const ocr = await PaddleOcrService.createInstance({
    ort,
    modelPreset: 'PP-OCRv5_mobile',
    detection: { modelBuffer: toArrayBuffer(detBuf) },
    recognition: {
      modelBuffer: toArrayBuffer(recBuf),
      // v4 rec 模型输出 6625 类（6623 字符 + blank 等占位），字典补齐
      charactersDictionary: [...dictText.trimEnd().split(/\r?\n/), '', '']
    },
    textlineOrientation: { modelBuffer: toArrayBuffer(clsBuf), threshold: 0.9 }
  })

  const inputPixels = await decodePng(imgFile)
  console.log(`图片: ${imgFile}  ${inputPixels.width}x${inputPixels.height}`)

  const t0 = Date.now()
  const results = await ocr.recognize(inputPixels, {
    detection: { limitType: 'max', maxSideLimit: 3000, unclipRatio: 1.6 },
    ordering: { sortByReadingOrder: true }
  })
  const text = ocr.processRecognition(results).text
  const dt = Date.now() - t0
  console.log(`耗时: ${dt}ms`)
  console.log('--- 识别结果 ---')
  console.log(text || '(未识别到文字)')
}

main().catch((e) => {
  console.error('OCR 冒烟失败:', e)
  process.exit(1)
})
