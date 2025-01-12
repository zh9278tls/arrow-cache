import StoreWorker from "./workers/store.worker.ts";
import { Channel } from "./channel";
import { KeysTypeData, KeysType, CacheData, CacheKey } from "./dtos";
import { Snapshot } from "./cache/cache";

export interface ParsedCacheItemOptions {
  isOnlyMemory: boolean;
  isAlwaysActive: boolean;
}

export interface ParsedCacheOptions {
  isPermanentMemory: boolean;
  clearDuration: number;
}

export type CacheOptions = Partial<ParsedCacheOptions>;
export type CacheItemOptions = Partial<ParsedCacheItemOptions>;

type AllowStorageTypes = boolean | string | number | object | Array<unknown>;

export class ArrowCache {
  private store: StoreWorker;
  private channel: Channel;
  private cacheOptions: ParsedCacheOptions;
  private initPromise: Promise<undefined>;

  constructor(options?: CacheOptions) {
    this.store = new StoreWorker();
    this.channel = new Channel(this.store);
    this.cacheOptions = this.parseCacheOptions(options);

    this.initPromise = new Promise(resolve => this.init(resolve));
  }

  InitSuccess() {
    return this.initPromise;
  }

  async init(resolve: () => void) {
    this.sendMsg("init", this.cacheOptions);

    if (this.cacheOptions.isPermanentMemory) {
      await this.sendMsg("readAllInMemory");

      resolve();
    }
  }

  private sendMsg<R, T = unknown>(type: string, data?: T): Promise<R> {
    return this.channel.send({
      type,
      data: data || {}
    });
  }

  private parseOptions<T extends object>(defaultOptions: T, options: T) {
    return {
      ...defaultOptions,
      ...(options || {})
    };
  }

  private parseCacheOptions(options: CacheOptions): ParsedCacheOptions {
    return this.parseOptions(
      {
        isPermanentMemory: false,
        clearDuration: 20000
      },
      options
    ) as ParsedCacheOptions;
  }

  private parseCacheItemOptions(
    options: CacheItemOptions
  ): ParsedCacheItemOptions {
    return this.parseOptions(
      {
        isOnlyMemory: false,
        isAlwaysActive: false
      },
      options
    ) as ParsedCacheItemOptions;
  }

  /**
   * get all keys of cache block including disk
   */
  activeKeys(): Promise<string[]> {
    return this.sendMsg<string[], KeysTypeData>("keys", {
      type: KeysType.ACTIVE
    });
  }
  /**
   * get all keys of cache block including disk
   */
  staticKeys(): Promise<string[]> {
    return this.sendMsg<string[], KeysTypeData>("keys", {
      type: KeysType.STATIC
    });
  }
  /**
   * get all keys of cache block including memory and disk
   */
  keys(): Promise<string[]> {
    return this.sendMsg<string[], KeysTypeData>("keys", {
      type: KeysType.ALL
    });
  }
  /**
   * clear all cache blocks from disk
   */
  activeClear(): Promise<boolean> {
    return this.sendMsg("clear", { key: KeysType.ACTIVE });
  }
  /**
   * clear all cache blocks from memory
   */
  staticClear(): Promise<boolean> {
    return this.sendMsg("clear", { key: KeysType.STATIC });
  }
  /**
   * clear all cache blocks, include memory and disk
   */
  clear(): Promise<void> {
    return this.sendMsg("clear", { key: KeysType.ALL });
  }
  /**
   * mark the isActivated of the cache block as true and move it into memory
   */
  markAsActive(key: string): Promise<boolean> {
    return this.sendMsg("mark", { type: KeysType.ACTIVE, key });
  }
  /**
   * mark the isActivated of the cache block as false and move it into iceHouse,
   * BTW, the isActivated field just exist in memory.
   * The iceHouse data structure looks like following:
   *
   * interface ColdDataItem {
   *   key: string;
   *   content: string;
   * }
   *
   */
  markAsStatic(key: string): Promise<boolean> {
    return this.sendMsg("mark", { type: KeysType.STATIC, key });
  }
  /**
   * setItem will set a cache block in memory if the key does not exist in cache,
   * otherwise, arrow-cache will read the cache block into memory and update content
   * of the cache block.
   */
  setItem(
    key: string,
    content: AllowStorageTypes,
    options?: CacheItemOptions
  ): Promise<boolean> {
    return this.sendMsg("saveData", {
      key,
      content: JSON.stringify(content),
      options: this.parseCacheItemOptions(options)
    });
  }
  /**
   * append a new value to an existing cacheItem
   */
  async append<T extends AllowStorageTypes>(
    key: string,
    cb: (data: T) => T,
    defaultValue: T
  ): Promise<T>;
  async append<T extends AllowStorageTypes>(
    key: string,
    cb: (data: T | undefined) => T,
    defaultValue?: T | undefined
  ): Promise<T>;
  async append<T extends AllowStorageTypes>(
    key: string,
    cb: (data: T | undefined) => T,
    defaultValue: T | undefined
  ): Promise<T> {
    const val = await this.getItem(key, defaultValue);
    const appendVal = cb(val as any);

    this.setItem(key, appendVal);

    return appendVal;
  }
  /**
   * get cache block from memory or disk
   */
  async getItem<T extends AllowStorageTypes>(
    key: string,
    defaultValue: AllowStorageTypes
  ): Promise<T>;
  async getItem<T extends AllowStorageTypes>(
    key: string
  ): Promise<T | undefined>;
  async getItem<T extends AllowStorageTypes>(
    key: string,
    defaultValue?: AllowStorageTypes
  ): Promise<T | undefined> {
    const content: string = await this.sendMsg("getItem", {
      key,
      content: defaultValue
    });
    let result: AllowStorageTypes;

    try {
      result = JSON.parse(content);
    } catch (e) {
      result = content;
    }

    return result as T;
  }
  /**
   * remove the cache block of key from memory or disk
   */
  removeItem(key: string): Promise<string | undefined> {
    return this.sendMsg<string, CacheKey>("removeItem", { key });
  }
  /**
   * Each cache block has a lifeCount attribute, and every once in a while lifeCount will be -1,
   * arrow-cache will remove cache block whose is lifeCount = 0 from memory and write it in disk,
   * arrow-cache will read it into memory when use the cache block next time.
   * moveToNextStream will move the cache block of key in next clear-circle.
   * So you can keep extending the life of cache block.
   */
  moveToNextStream(key: string): Promise<boolean> {
    return this.sendMsg("moveToNextStream", { key });
  }
  /**
   * updateContent is a idempotent method that will update content of key.
   * if the cache block is exist in icehouse, updateContent does not make it as active.
   */
  updateContent(key: string, content: string): Promise<boolean> {
    return this.sendMsg<boolean, CacheData>("updateContent", { key, content });
  }

  snapshot(): Promise<Snapshot<true>> {
    return this.sendMsg("snapshot");
  }
}
