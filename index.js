import "dotenv/config";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { signPermit, poolManagerAbi } from "./permit.js";
import { 
        createPublicClient, 
        http, 
        getContract, 
        erc20Abi, 
        hexToBigInt, 
        encodePacked 
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
const account = await toSimple7702SmartAccount({ client, owner });

console.log(account.address);

const paymasterAddress = process.env.PAYMASTER_V08_ADDRESS;

const paymaster = {
  async getPaymasterData(parameters) {
    const permitAmount = 10000000n;
    const permitSignature = await signPermit({
      tokenAddress: usdcAddress,
      account,
      client,
      spenderAddress: paymasterAddress,
      permitAmount: permitAmount,
    });

    const paymasterData = encodePacked(
      ["uint8", "address", "uint256", "bytes"],
      [0, usdcAddress, permitAmount, permitSignature],
    );

    return {
      paymaster: paymasterAddress,
      paymasterData,
      paymasterVerificationGasLimit: 200000n,
      paymasterPostOpGasLimit: 15000n,
      isFinal: true,
    };
  },
};

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
    transport: http(`https://public.pimlico.io/v2/${client.chain.id}/rpc`),
  });

const recipientAddress = process.env.RECIPIENT_ADDRESS;
const usdc = getContract({ client, address: usdcAddress, abi: erc20Abi });

// Sign authorization for 7702 account
const authorization = await owner.signAuthorization({
  chainId: chain.id,
  nonce: await client.getTransactionCount({ address: owner.address }),
  contractAddress: account.authorization.address,
});

const hash = await bundlerClient.sendUserOperation({
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

/*const hash = await bundlerClient.sendUserOperation({
  account,
  calls: [
    {
      to: poolManagerAddress,
      abi: poolManagerAbi,
      functionName: "swap",
      args: [
        poolKey,
        {
          recipient: recipientAddress,
          zeroForOne: true,           // direction: token0 -> token1
          amountSpecified: 1_000n,   // positive = exact input
          sqrtPriceLimitX96: 0n,      // set as needed, often 0
        },
        encodedMessage,       // passed to your hook
      ],
    },
  ],
  authorization,
});*/

console.log("UserOperation hash", hash);

const receipt = await bundlerClient.waitForUserOperationReceipt({ hash });
console.log("Transaction hash", receipt.receipt.transactionHash);

// We need to manually exit the process, since viem leaves some promises on the
// event loop for features we're not using.
process.exit();