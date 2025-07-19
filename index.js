import "dotenv/config";
import { arbitrumSepolia, sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { signPermit, swapRouterAbi } from "./permit.js";
import { 
        createPublicClient, 
        http, 
        getContract, 
        erc20Abi, 
        hexToBigInt, 
        encodePacked,
        maxUint256,
        parseAbi,
        parseEther
    } from "viem";
import {
        createBundlerClient,
        toSimple7702SmartAccount,
    } from "viem/account-abstraction";
import { parse } from "dotenv";

const chain = sepolia;
//const usdcAddress = process.env.USDC_ADDRESS;
const usdcAddress = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const ownerPrivateKey = process.env.OWNER_PRIVATE_KEY;

const client = createPublicClient({ chain, transport: http() });
const owner = privateKeyToAccount(ownerPrivateKey);

// Initializes a 7702 smart accont (an ERC-4437 account abstraction)
const account = await toSimple7702SmartAccount({ client, owner });

console.log(account.address);

const paymasterAddress = process.env.PAYMASTER_V08_ADDRESS;

// Debug: Check if paymaster address is provided
if (!paymasterAddress) {
  console.error("❌ PAYMASTER_V08_ADDRESS environment variable is not set");
  process.exit(1);
}

console.log("Using paymaster address:", paymasterAddress);

// Check if paymaster contract exists
try {
  const paymasterCode = await client.getBytecode({ address: paymasterAddress });
  if (!paymasterCode || paymasterCode === '0x') {
    console.error("❌ Paymaster contract is not deployed at address:", paymasterAddress);
    console.error("Please deploy the paymaster contract or use a different address");
    process.exit(1);
  }
  console.log("✅ Paymaster contract found at address:", paymasterAddress);
  
  // Let's also check if this is actually a paymaster contract by calling a basic function
  try {
    const paymasterContract = getContract({ 
      client, 
      address: paymasterAddress, 
      abi: parseAbi(["function validatePaymasterUserOp((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes32,uint256,bytes,bytes),bytes32,uint256) view returns (uint256,uint256)"])
    });
    console.log("✅ Paymaster contract has validatePaymasterUserOp function");
  } catch (error) {
    console.warn("⚠️  Warning: Contract may not be a valid paymaster:", error.message);
  }
} catch (error) {
  console.error("❌ Error checking paymaster contract:", error.message);
  process.exit(1);
}

// Paymaster Object
// Defines a paymaster object with a method to generate paymaster data.
// Signs an EIP-2612 permit so the paymaster can spend the user's USDC.

const paymaster = {
  async getPaymasterData(parameters) {
    const permitAmount = 10000000n; // 10 million USDC (6 decimals)
    const permitSignature = await signPermit({
      tokenAddress: usdcAddress,
      account,
      client,
      spenderAddress: paymasterAddress,
      permitAmount: permitAmount,
    });

    // Encodes the permit data for the user operation.
    const paymasterData = encodePacked(
      ["uint8", "address", "uint256", "bytes"],
      [0, usdcAddress, permitAmount, permitSignature],
    );

    return {
      paymaster: paymasterAddress,
      paymasterData,
      paymasterVerificationGasLimit: 2000000n,
      paymasterPostOpGasLimit: 150000n,
      isFinal: true,
    };
  },
};

// Sets up a bundler client with the account, paymaster, and a custom gas estimator.
// Bundler: A service that collects, validates, and submits user operations to the 
// blockchain in ERC-4337.
const bundlerClient = createBundlerClient({
    account,
    client,
    paymaster,
    userOperation: {
      estimateFeesPerGas: async ({ account, bundlerClient, userOperation }) => {
        const { standard: fees } = await bundlerClient.request({
          method: "pimlico_getUserOperationGasPrice",
        });
        const maxFeePerGas = hexToBigInt(fees.maxFeePerGas);
        const maxPriorityFeePerGas = hexToBigInt(fees.maxPriorityFeePerGas);
        return { maxFeePerGas, maxPriorityFeePerGas };
      },
    },
    // ERC-4337 bundlers are relayers that bundle user operations into transactions
    // and submit them to the blockchain. You can interact with bundlers using standard 
    // JSON-RPC requests.
    transport: http(`https://public.pimlico.io/v2/${client.chain.id}/rpc`),
  });

// Loads the recipient address and creates a contract instance for USDC.
const recipientAddress = process.env.RECIPIENT_ADDRESS;
const usdc = getContract({ client, address: usdcAddress, abi: erc20Abi });

// Sign authorization for 7702 account
const authorization = await owner.signAuthorization({
  chainId: chain.id,
  nonce: await client.getTransactionCount({ address: owner.address }),
  contractAddress: account.authorization.address,
});

// UserOperation: The core transaction type in ERC-4337, which can include 
// multiple contract calls and is handled by the bundler
/*const hash = await bundlerClient.sendUserOperation({
  account,
  calls: [
    {
      to: usdc.address,
      abi: usdc.abi,
      functionName: "transfer",
      args: [recipientAddress, 10000n],
    },
  ],
  authorization: authorization,
}); */


// **************** 
const hookData = "0x"; // empty bytes
const hookContractAddress = "0x0515E5b569611Db2eC5C6E0CD6cFc79bf9aca080"; // not zero address
// const hookContractAddress = "0x0000000000000000000000000000000000000000"; // zero address

const token0 = process.env.MXNB_ADDRESS;
const token1 = process.env.USDC_ADDRESS;

const swapRouterAddress = process.env.SWAP_ROUTER_ADDRESS;

const poolKey = {
  currency0: token0,
  currency1: token1,
  fee: 0x800000,
  tickSpacing: 10,
  hooks: hookContractAddress,
};
try {
  console.log("Starting swap operation...");
  console.log("Token0 (MXNB):", token0);
  console.log("Token1 (USDC):", token1);
  console.log("Swap Router:", swapRouterAddress);
  console.log("Pool Key:", poolKey);
  
  const hash = await bundlerClient.sendUserOperation({
    account,
    calls: [
      /*{
        to: token0,
        abi: erc20Abi,
        functionName: "approve",
        args: [swapRouterAddress, maxUint256], // Approve token0
      },
      {
        to: token1,
        abi: erc20Abi,
        functionName: "approve",
        args: [swapRouterAddress, maxUint256], // Approve token1
      }, */
      {
        to: swapRouterAddress,
        abi: swapRouterAbi, // You must define this ABI to include `swapExactTokensForTokens`
        functionName: "swapExactTokensForTokens",
        args: [
          parseEther("1"),     // amountIn - 1 token (assuming 6 decimals)
          0,                             // amountOutMin (be cautious!)
          true,                          // zeroForOne
          poolKey,
          hookData,
          process.env.RECIPIENT_ADDRESS, // receiver
          Math.floor(Date.now() / 1000) + 3600          // deadline
        ],
      },
    ],
    authorization: authorization,
  }); 

console.log("UserOperation hash", hash);

const receipt = await bundlerClient.waitForUserOperationReceipt({ hash });
console.log("Transaction hash", receipt.receipt.transactionHash);

} catch (error){
  console.error("❌ Error sending UserOperation:", error);
} 

// We need to manually exit the process, since viem leaves some promises on the
// event loop for features we're not using.
process.exit();