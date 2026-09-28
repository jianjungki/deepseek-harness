/**
 * Validate the version carried by an unsigned Desktop GitHub release tag.
 * @param tag - Selected existing Git tag.
 * @param product - Version declared by the Desktop package.
 * @returns Version passed to each packaging target.
 */
export function validateDesktopUnsignedReleaseTag(tag: string, product: string): string
