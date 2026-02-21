"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPoseidonHasher = createPoseidonHasher;
const circomlibjs_1 = require("circomlibjs");
async function createPoseidonHasher() {
    const poseidon = await (0, circomlibjs_1.buildPoseidon)();
    const field = poseidon.F;
    return (inputs) => {
        const normalized = inputs.map((input) => {
            if (typeof input === "bigint") {
                return input;
            }
            if (typeof input === "number") {
                return BigInt(input);
            }
            if (input.startsWith("0x")) {
                return BigInt(input);
            }
            return BigInt(input);
        });
        const res = poseidon(normalized);
        return field.toObject(res);
    };
}
