// Minimal type declarations for the untyped `app-store-scraper` package.
declare module "app-store-scraper" {
  type Opts = Record<string, unknown>;
  type Method = (opts: Opts) => Promise<any>;

  interface Store {
    app: Method;
    list: Method;
    search: Method;
    developer: Method;
    privacy: Method;
    suggest: Method;
    similar: Method;
    reviews: Method;
    ratings: Method;
    collection: Record<string, string>;
    category: Record<string, number>;
    device: Record<string, string>;
    sort: Record<string, string>;
    markets: Record<string, number>;
    memoized(opts?: { maxAge?: number; max?: number }): Store;
  }

  const store: Store;
  export default store;
}
