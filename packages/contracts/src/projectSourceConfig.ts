const projectSourceFileExtensions: readonly string[] = Object.freeze(['txt']);

export const PROJECT_SOURCE_FILE_CONFIG = Object.freeze({
  displayName: 'TXT 文本文件',
  extensions: projectSourceFileExtensions,
});

export function isSupportedProjectSourceFileName(fileName: string): boolean {
  const extensionSeparatorIndex = fileName.lastIndexOf('.');
  if (extensionSeparatorIndex <= 0 || extensionSeparatorIndex === fileName.length - 1)
    return false;

  const extension = fileName.slice(extensionSeparatorIndex + 1).toLowerCase();
  return PROJECT_SOURCE_FILE_CONFIG.extensions.includes(extension);
}
