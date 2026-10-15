/**
 * Small glob matcher (`**`, `*`, `?`, `[...]`, `{a,b}`) for workspace-relative
 * POSIX paths. A pattern without a slash matches the basename at any depth,
 * like `.gitignore`.
 */

const cache = new Map<string, RegExp>()

/**
 * Compile one glob to a regular expression.
 * @param glob - the pattern.
 * @returns an anchored expression over a POSIX relative path.
 */
export function globToRegExp(glob: string): RegExp {
  const cached = cache.get(glob)
  if (cached !== undefined) return cached
  let pattern = glob.trim().replace(/^\.\//, '')
  if (pattern.startsWith('/')) pattern = pattern.slice(1)
  else if (!pattern.includes('/')) pattern = `**/${pattern}`
  if (pattern.endsWith('/')) pattern += '**'
  let re = ''
  let i = 0
  let braces = 0
  while (i < pattern.length) {
    const ch = pattern[i]!
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        const slashAfter = pattern[i + 2] === '/'
        re += slashAfter ? '(?:.*/)?' : '.*'
        i += slashAfter ? 3 : 2
        continue
      }
      re += '[^/]*'
    } else if (ch === '?') {
      re += '[^/]'
    } else if (ch === '[') {
      const end = pattern.indexOf(']', i + 1)
      if (end === -1) re += '\\['
      else {
        re += `[${pattern.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`
        i = end
      }
    } else if (ch === '{') {
      braces += 1
      re += '(?:'
    } else if (ch === '}' && braces > 0) {
      braces -= 1
      re += ')'
    } else if (ch === ',' && braces > 0) {
      re += '|'
    } else {
      re += ch.replace(/[.+^${}()|\\]/g, '\\$&')
    }
    i += 1
  }
  const compiled = new RegExp(`^${re}$`)
  cache.set(glob, compiled)
  return compiled
}

/**
 * Test a relative path against any of the globs.
 * @param path - workspace-relative path with `/` separators.
 * @param globs - patterns; a leading `!` negates (later entries win).
 * @returns whether the path is selected.
 */
export function matchesAny(path: string, globs: readonly string[]): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
  let matched = false
  for (const glob of globs) {
    if (glob.startsWith('!')) {
      if (globToRegExp(glob.slice(1)).test(normalized)) matched = false
    } else if (globToRegExp(glob).test(normalized)) {
      matched = true
    }
  }
  return matched
}
