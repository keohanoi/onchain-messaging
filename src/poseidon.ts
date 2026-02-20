import { buildPoseidon } from "circomlibjs";

export async function createPoseidonHasher() {
  const poseidon = await buildPoseidon();
  const field = poseidon.F;

  return (inputs: Array<bigint | number | string>): bigint => {
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
    return field.toObject(res) as bigint;
  };
}
