/**
 * Validate the version carried by an unsigned Desktop GitHub release tag.
 * @param tag - Selected existing Git tag.
 * @param product - Version declared by the Desktop package.
 * @returns Version passed to each packaging target.
 */
export function validateDesktopUnsignedReleaseTag(tag: string, product: string): string

/**
 * Validate that a selected Desktop source tree produces the published Windows formats.
 * @param builderSource - Contents of the selected tree's electron-builder configuration.
 * @returns Nothing when the source is compatible; throws otherwise.
 */
export function validateDesktopUnsignedPackagingSource(builderSource: string): void
