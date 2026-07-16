import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const uploadsDir = path.join(__dirname, '..', 'data', 'uploads')

const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

const EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

fs.mkdirSync(uploadsDir, { recursive: true })

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, uploadsDir)
  },
  filename(_req, file, cb) {
    const ext = EXT[file.mimetype] || path.extname(file.originalname) || '.jpg'
    cb(null, `${uuidv4()}${ext}`)
  },
})

export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 12 },
  fileFilter(_req, file, cb) {
    if (!ALLOWED.has(file.mimetype)) {
      cb(new Error('仅支持 jpg / png / gif / webp 图片'))
      return
    }
    cb(null, true)
  },
})
