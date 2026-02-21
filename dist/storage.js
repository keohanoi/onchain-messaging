"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createIpfsStorage = createIpfsStorage;
exports.createArweaveStorage = createArweaveStorage;
const ipfs_http_client_1 = require("ipfs-http-client");
const arweave_1 = __importDefault(require("arweave"));
function createIpfsStorage(url) {
    const client = (0, ipfs_http_client_1.create)({ url });
    return {
        async add(data) {
            const result = await client.add(data);
            return result.cid.toString();
        },
        async get(cid) {
            const chunks = [];
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
function createArweaveStorage(config, jwk) {
    const arweave = arweave_1.default.init(config);
    return {
        async add(data) {
            const tx = await arweave.createTransaction({ data });
            await arweave.transactions.sign(tx, jwk);
            const response = await arweave.transactions.post(tx);
            if (response.status >= 400) {
                throw new Error(`Arweave upload failed: ${response.status}`);
            }
            return tx.id;
        },
        async get(id) {
            const data = await arweave.transactions.getData(id, { decode: true, string: false });
            return new Uint8Array(data);
        }
    };
}
