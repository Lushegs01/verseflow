/**
 * solc ships no type declarations. Only the two entry points this repo calls are
 * declared; the compiler's standard-JSON payload is validated where it is parsed.
 */
declare module "solc" {
  const solc: {
    compile(input: string): string;
    version(): string;
  };
  export default solc;
}
