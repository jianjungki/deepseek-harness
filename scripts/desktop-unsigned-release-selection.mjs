/**
 * Validate the version carried by an unsigned Desktop GitHub release tag.
 * @param {string} tag - Selected existing Git tag.
 * @param {string} product - Version declared by the Desktop package.
 * @returns {string} Version passed to each packaging target.
 */
export function validateDesktopUnsignedReleaseTag(tag, product) {
  if (!/^desktop-unsigned-v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error('Expected desktop-unsigned-v<version>')
  }
  const version = tag.slice('desktop-unsigned-v'.length)
  const escapedProduct = product.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const testPattern = product.includes('-')
    ? new RegExp(`^${escapedProduct}\\.[0-9]{8}\\.[1-9][0-9]*$`)
    : new RegExp(`^${escapedProduct}-test\\.[0-9]{8}\\.[1-9][0-9]*$`)
  if (version !== product && !testPattern.test(version)) {
    throw new Error('Tag version must equal the Desktop product version or extend it with a dated test-build suffix')
  }
  return version
}

/**
 * Validate that a selected Desktop source tree produces the published Windows formats.
 * @param {string} builderSource - Contents of the selected tree's electron-builder configuration.
 * @returns {void}
 */
export function validateDesktopUnsignedPackagingSource(builderSource) {
  if (!/target\s*:\s*\[\s*['"]nsis['"]\s*,\s*['"]zip['"]\s*\]/u.test(builderSource)) {
    throw new Error('Selected Desktop source does not include the Windows ZIP target; create a new tag from the current packaging commit')
  }
}
