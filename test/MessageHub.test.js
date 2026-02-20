const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MessageHub", () => {
  async function deploy() {
    const Verifier = await ethers.getContractFactory("ZKVerifier");
    const verifier = await Verifier.deploy();
    const MessageHub = await ethers.getContractFactory("MessageHub");
    const hub = await MessageHub.deploy(await verifier.getAddress());
    return { hub, verifier };
  }

  it("posts direct messages and records nullifier", async () => {
    const { hub } = await deploy();
    const [, recipient] = await ethers.getSigners();

    const nullifier = ethers.keccak256(ethers.toUtf8Bytes("n1"));
    const metadata = ethers.randomBytes(64);
    const ephemeralPubKey = 123n;

    await expect(
      hub.postDirectMessage(recipient.address, ephemeralPubKey, metadata, nullifier)
    ).to.emit(hub, "MessagePosted");

    expect(await hub.usedNullifiers(nullifier)).to.equal(true);
  });

  it("rejects reused nullifier", async () => {
    const { hub } = await deploy();
    const [, recipient] = await ethers.getSigners();

    const nullifier = ethers.keccak256(ethers.toUtf8Bytes("n2"));
    const metadata = ethers.randomBytes(32);

    await hub.postDirectMessage(recipient.address, 1n, metadata, nullifier);

    await expect(
      hub.postDirectMessage(recipient.address, 2n, metadata, nullifier)
    ).to.be.revertedWith("Nullifier used");
  });

  it("posts group message when verifier approves", async () => {
    const { hub, verifier } = await deploy();

    const groupId = ethers.keccak256(ethers.toUtf8Bytes("group"));
    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("root"));
    await verifier.setValidRoot(groupId, merkleRoot, true);

    const nullifier = ethers.keccak256(ethers.toUtf8Bytes("g1"));
    const metadata = ethers.randomBytes(48);
    const proof = ethers.randomBytes(32);

    await expect(
      hub.postGroupMessage(groupId, metadata, proof, nullifier, merkleRoot)
    ).to.emit(hub, "GroupMessagePosted");
  });
});
