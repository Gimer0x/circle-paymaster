import "dotenv/config";
import { sepolia } from "viem/chains";
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

const chain = sepolia;
const usdcAddress = process.env.USDC_ADDRESS;
const ownerPrivateKey = process.env.OWNER_PRIVATE_KEY;

const client = createPublicClient({ chain, transport: http() });
const owner = privateKeyToAccount(ownerPrivateKey);

// Initializes a 7702 smart accont (an ERC-4437 account abstraction)
const account = await toSimple7702SmartAccount({ client, owner });

console.log(account.address);

const paymasterAddress = process.env.PAYMASTER_V08_ADDRESS;

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
      paymasterVerificationGasLimit: 200000n,
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
});
*/

// **************** 
const hookData = "0x"; // empty bytes
const hookContractAddress = "0x0000000000000000000000000000000000000000"; // zero address

const token0 = "0x6adC6e83Ebe1b63F6a360f8fF1feF1F84A79291e";
const token1 = "0x2d09B9a91132e2E394A7C43e0d7FE7a81Ed96e3B";
//const swapRouterAddress = "0x00000000000044a361Ae3cAc094c9D1b14Eece97";

const swapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

const poolKey = {
  currency0: token0,
  currency1: token1,
  fee: 500,
  tickSpacing: 10,
  hooks: hookContractAddress,
};
try {
const hash = await bundlerClient.sendUserOperation({
  account,
  calls: [
   {
      to: token0,
      abi: parseAbi(["function approve(address,uint)"]),
      functionName: "approve",
      args: [swapRouterAddress, maxUint256], // Approve token0
    },
    /*{
      to: token1,
      abi: erc20Abi,
      functionName: "approve",
      args: [swapRouterAddress, maxUint256], // Approve token1
    },*/
    {
      to: swapRouterAddress,
      abi: swapRouterAbi, // You must define this ABI to include `swapExactTokensForTokens`
      functionName: "swapExactTokensForTokens",
      args: [
        parseEther("0.5"),     // amountIn
        0,                             // amountOutMin (be cautious!)
        true,                          // zeroForOne
        poolKey,
        hookData,
        0x0d2Dc4E9ebc1465E86Fdf6ab18377CB82eCf7548, // receiver
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