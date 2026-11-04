/** The POSIX matcher options used by the unchanged pinned tab registry. */
declare module 'picomatch/posix' {
  interface MatchOptions {
    readonly nocase?: boolean
    readonly dot?: boolean
    readonly basename?: boolean
  }
  export default function picomatch(pattern: string, options?: MatchOptions): (value: string) => boolean
}
