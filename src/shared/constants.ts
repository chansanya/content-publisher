export const DEFAULT_FTP_PORT = 21

/** 进度事件推送节流间隔（毫秒），关键节点（文件完成、阶段切换、结束）不受节流限制 */
export const PROGRESS_THROTTLE_MS = 100

/** 上传速度滑动窗口（毫秒） */
export const SPEED_WINDOW_MS = 5000

export const ARTIFACTS_DIR_NAME = 'artifacts'

export const DEFAULT_RECORD_DIR_NAME = 'historical'

export const ARTIFACT_ZIP_NAME = 'artifact.zip'

export const MANIFEST_JSON_NAME = 'manifest.json'

/** .ftpignore 之外内置的默认忽略规则，语法与 .gitignore 一致 */
export const DEFAULT_IGNORE_RULES: readonly string[] = [
  '.git/',
  'node_modules/',
  '.env',
  '.env.*',
  '.ftpignore',
  '.historical/',
  'historical/',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '*.tmp',
  '~$*'
]

export const MAX_ZIP_FILES = 50_000
export const MAX_ZIP_ENTRY_BYTES = 512 * 1024 * 1024
export const MAX_ZIP_TOTAL_BYTES = 4 * 1024 * 1024 * 1024

export const REQUIRED_ENV_KEYS = ['FTP_HOST', 'FTP_USER', 'FTP_PASSWORD', 'FTP_REMOTE_ROOT'] as const

/** 可回滚记录的最大返回条数 */
export const MAX_RECORDS = 500
