import { 
  createPublicClient, 
  createWalletClient, 
  http, 
  parseUnits, 
  formatUnits, 
  type Address 
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import * as dotenv from 'dotenv';

dotenv.config();

// 1. Configuration & Client Setup
const RPC_URL = process.env.ETH_RPC_URL || 'https://eth.llamarpc.com';
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;

if (!PRIVATE_KEY) {
  console.error('❌ Error: PRIVATE_KEY is missing in environment variables.');
  process.exit(1);
}

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
});

const account = privateKeyToAccount(PRIVATE_KEY);
const walletClient = createWalletClient({
  account,
  chain: mainnet,
  transport: http(RPC_URL),
});

// 2. DEX Router Addresses (Uniswap V2 & SushiSwap V2 on Ethereum Mainnet)
const UNISWAP_V2_ROUTER: Address = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
const SUSHISWAP_V2_ROUTER: Address = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F';

// 3. Token Addresses (WETH & USDC)
const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

// Minimal ABI for Uniswap/SushiSwap V2 Routers
const ROUTER_ABI = [
  {
    inputs: [
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'address[]', name: 'path', type: 'address[]' }
    ],
    name: 'getAmountsOut',
    outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
      { internalType: 'address[]', name: 'path', type: 'address[]' },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' }
    ],
    name: 'swapExactTokensForTokens',
    outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'nonpayable',
    type: 'function'
  }
] as const;

// 4. Arbitrage Scanner Logic
async function checkArbitrageOpportunity() {
  try {
    const amountIn = parseUnits('1', 18); // Test with 1 WETH
    const pathUniToSushi = [WETH, USDC];
    const pathSushiToUni = [USDC, WETH];

    // Step A: Get quote from Uniswap V2
    const uniAmounts = await publicClient.readContract({
      address: UNISWAP_V2_ROUTER,
      abi: ROUTER_ABI,
      functionName: 'getAmountsOut',
      args: [amountIn, pathUniToSushi],
    });

    const usdcOut = uniAmounts[1];

    // Step B: Get quote back from SushiSwap V2
    const sushiAmounts = await publicClient.readContract({
      address: SUSHISWAP_V2_ROUTER,
      abi: ROUTER_ABI,
      functionName: 'getAmountsOut',
      args: [usdcOut, pathSushiToUni],
    });

    const finalWethOut = sushiAmounts[1];

    console.log(`[Scan] Initial WETH: ${formatUnits(amountIn, 18)}`);
    console.log(`[Scan] Return WETH (Uni -> Sushi): ${formatUnits(finalWethOut, 18)}`);

    // Step C: Check if profitable (accounting for basic estimation)
    if (finalWethOut > amountIn) {
      const grossProfit = finalWethOut - amountIn;
      console.log(`🚀 Arbitrage found! Gross Profit: ${formatUnits(grossProfit, 18)} WETH`);
      
      // Execute the trade
      await executeTrade(amountIn, usdcOut);
    } else {
      console.log('⏳ No profitable arbitrage opportunity found.');
    }
  } catch (error) {
    console.error('Error scanning for arbitrage:', error);
  }
}

// 5. Execution Handler
async function executeTrade(amountIn: bigint, minUsdcOut: bigint) {
  try {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60); // 1 minute from now

    console.log('Preparing transaction submission...');
    
    // Example transaction dispatch (Ensure your account has approved the routers beforehand)
    const hash = await walletClient.writeContract({
      address: UNISWAP_V2_ROUTER,
      abi: ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [amountIn, [WETH, USDC], account.address, deadline],
    });

    console.log(`✅ Transaction submitted successfully! Hash: ${hash}`);
    
    // Wait for transaction receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`📦 Transaction confirmed in block ${receipt.blockNumber}`);

  } catch (err) {
    console.error('❌ Execution failed:', err);
  }
}

// Run bot scanner every 12 seconds (approximate Ethereum block time)
console.log('🤖 Starting Ethereum Arbitrage Bot...');
setInterval(checkArbitrageOpportunity, 12000);