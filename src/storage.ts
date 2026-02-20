import { create } from "ipfs-http-client";
import Arweave from "arweave";
import type { JWKInterface } from "arweave/node/lib/wallet";

export interface StorageClient {
  add(data: Uint8Array): Promise<string>;
  get(cidOrId: string): Promise<Uint8Array>;
}

export function createIpfsStorage(url: string): StorageClient {
  const client = create({ url });

  return {
    async add(data: Uint8Array) {
      const result = await client.add(data);
      return result.cid.toString();
    },
    async get(cid: string) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of client.cat(cid)) {
        chunks.push(chunk);
      }
      const total = chunks.reduce((sum, c) => sum + c.length, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      return out;
    }
  };
}

export function createArweaveStorage(
  config: { host: string; port: number; protocol: "http" | "https" },
  jwk: JWKInterface
): StorageClient {
  const arweave = Arweave.init(config);

  return {
    async add(data: Uint8Array) {
      const tx = await arweave.createTransaction({ data });
      await arweave.transactions.sign(tx, jwk);
      const response = await arweave.transactions.post(tx);
      if (response.status >= 400) {
        throw new Error(`Arweave upload failed: ${response.status}`);
      }
      return tx.id;
    },
    async get(id: string) {
      const data = await arweave.transactions.getData(id, { decode: true, string: false });
      return new Uint8Array(data as Uint8Array);
    }
  };
}
