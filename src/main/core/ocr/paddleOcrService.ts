import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { PNG } from 'pngjs'
import * as ort from 'onnxruntime-node'
import { PaddleOcrService, type OrtModule } from 'paddleocr'

/**
 * MT Launcher 本地 OCR 服务（截图识别插件后端）。
 *
 * 基于 PP-OCRv4 mobile ONNX 模型（det + textline cls + rec），模型与字典随
 * 内置插件分发（internal-plugins/screen-ocr/models/），全程本地推理、无需
 * 联网与 uTools 账号。推理由 paddleocr 运行时（轻量 TS 封装）承担：预处理、
 * DB 后处理、CTC 解码与文本行方向校正均已内置。
 *
 * 服务为懒加载单例：首次调用才读模型并创建推理实例（约 1-2 秒），
 * 后续识别复用同一实例。
 */

let instance: PaddleOcrService | null = null

function getModelsDir(): string {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'internal-plugins',
      'screen-ocr',
      'models'
    )
  }
  return path.join(app.getAppPath(), 'internal-plugins', 'screen-ocr', 'models')
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

async function getOcrService(): Promise<PaddleOcrService> {
  if (instance) return instance

  const dir = getModelsDir()
  const [detBuf, recBuf, clsBuf, dictText] = await Promise.all([
    fs.promises.readFile(path.join(dir, 'det.onnx')),
    fs.promises.readFile(path.join(dir, 'rec.onnx')),
    fs.promises.readFile(path.join(dir, 'cls.onnx')),
    fs.promises.readFile(path.join(dir, 'ppocr_keys_v1.txt'), 'utf8')
  ])

  const started = Date.now()
  instance = await PaddleOcrService.createInstance({
    ort: ort as unknown as OrtModule,
    modelPreset: 'PP-OCRv5_mobile',
    detection: { modelBuffer: toArrayBuffer(detBuf) },
    recognition: {
      modelBuffer: toArrayBuffer(recBuf),
      // v4 rec 模型输出 6625 类（6623 字符 + blank 等占位），字典补齐
      charactersDictionary: [...dictText.trimEnd().split(/\r?\n/), '', '']
    },
    textlineOrientation: { modelBuffer: toArrayBuffer(clsBuf), threshold: 0.9 }
  })
  console.log(`[OcrService] 模型加载完成（${Date.now() - started}ms）`)
  return instance
}

/**
 * 识别 PNG 缓冲区中的文字。
 * @param pngBuffer PNG 图片原始字节（RGBA 由运行时归一化）
 * @returns 按阅读顺序拼接的识别文本
 */
export async function recognizePng(pngBuffer: Buffer): Promise<string> {
  const png = PNG.sync.read(pngBuffer)
  const ocr = await getOcrService()
  const results = await ocr.recognize(
    { width: png.width, height: png.height, data: new Uint8Array(png.data) },
    {
      detection: { limitType: 'max', maxSideLimit: 3000, unclipRatio: 1.6 },
      ordering: { sortByReadingOrder: true }
    }
  )
  return ocr.processRecognition(results).text
}
