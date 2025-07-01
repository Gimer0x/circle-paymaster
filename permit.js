import { maxUint256, erc20Abi, parseErc6492Signature, getContract } from "viem";

// Adapted from https://github.com/vacekj/wagmi-permit/blob/main/src/permit.ts
export async function eip2612Permit({
  token,
  chain,
  ownerAddress,
  spenderAddress,
  value,
}) {
  return {
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    domain: {
      name: await token.read.name(),
      version: await token.read.version(),
      chainId: chain.id,
      verifyingContract: token.address,
    },
    message: {
      owner: ownerAddress,
      spender: spenderAddress,
      value,
      nonce: await token.read.nonces([ownerAddress]),
      // The paymaster cannot access block.timestamp due to 4337 opcode
      // restrictions, so the deadline must be MAX_UINT256.
      deadline: maxUint256,
    },
  };
}

export const eip2612Abi = [
  ...erc20Abi,
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
    name: "nonces",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
  },
  {
    inputs: [],
    name: "version",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
];

// Example ABI for Uniswap V2/V3 style swap router
export const swapRouterAbi = [
  {
    "inputs": [
      { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
      { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" },
      { "internalType": "bool", "name": "zeroForOne", "type": "bool" },
      { 
        "internalType": "tuple", 
        "name": "poolKey", 
        "type": "tuple",
        "components": [
          { "internalType": "address", "name": "currency0", "type": "address" },
          { "internalType": "address", "name": "currency1", "type": "address" },
          { "internalType": "uint24", "name": "fee", "type": "uint24" },
          { "internalType": "int24", "name": "tickSpacing", "type": "int24" },
          { "internalType": "address", "name": "hooks", "type": "address" }
        ]
      },
      { "internalType": "bytes", "name": "hookData", "type": "bytes" },
      { "internalType": "address", "name": "receiver", "type": "address" },
      { "internalType": "uint256", "name": "deadline", "type": "uint256" }
    ],
    "name": "swapExactTokensForTokens",
    "outputs": [
      { "internalType": "uint256", "name": "amountOut", "type": "uint256" }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

export const routerABI = [
  {
    inputs: [
      { internalType: "bytes", name: "commands", type: "bytes" },
      { internalType: "bytes[]", name: "inputs", type: "bytes[]" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ],
    name: "execute",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
]


export async function signPermit({
  tokenAddress,
  client,
  account,
  spenderAddress,
  permitAmount,
}) {
  const token = getContract({
    client,
    address: tokenAddress,
    abi: eip2612Abi,
  });
  const permitData = await eip2612Permit({
    token,
    chain: client.chain,
    ownerAddress: account.address,
    spenderAddress,
    value: permitAmount,
  });

  const wrappedPermitSignature = await account.signTypedData(permitData);

  const isValid = await client.verifyTypedData({
    ...permitData,
    address: account.address,
    signature: wrappedPermitSignature,
  });

  if (!isValid) {
    throw new Error(
      `Invalid permit signature for ${account.address}: ${wrappedPermitSignature}`,
    );
  }

  const { signature } = parseErc6492Signature(wrappedPermitSignature);
  return signature;
}
