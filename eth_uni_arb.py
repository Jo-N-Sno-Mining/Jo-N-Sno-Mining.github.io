import os
import math
from web3 import Web3

# Configuration
INFURA_URL = os.getenv("INFURA_RPC_URL", "https://mainnet.infura.io/v3/YOUR_API_KEY")
web3 = Web3(Web3.HTTPProvider(INFURA_URL))

# Uniswap V3 Factory & Quoter V2 Contracts (Example Mainnet Addresses)
UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984"
# Minimal ABI for Uniswap V3 Pool state checking
POOL_ABI = [
    {"inputs":[],"name":"slot0","outputs":[{"internalType":"uint160","name":"sqrtPriceX96","type":"uint160"},{"internalType":"int24","name":"tick","type":"int24"},{"internalType":"uint16","name":"observationIndex","type":"uint16"},{"internalType":"uint16","name":"observationCardinality","type":"uint16"},{"internalType":"uint16","name":"observationCardinalityNext","type":"uint16"},{"internalType":"uint16","name":"feeProtocol","type":"uint16"},{"internalType":"bool","name":"unlocked","type":"bool"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"liquidity","outputs":[{"internalType":"uint128","name":"liquidity","type":"uint128"}],"stateMutability":"view","type":"function"}
]

# Token definitions (WETH, USDC, WBTC)
TOKENS = {
    "WETH": {"address": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "decimals": 18},
    "USDC": {"address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "decimals": 6},
    "WBTC": {"address": "0x2260FAC5E5542a773Aa44FBcfedf7C193bc2C599", "decimals": 8}
}

def get_sqrt_price_x96(pool_address: str) -> int:
    """Fetches current sqrtPriceX96 from a Uniswap V3 pool contract."""
    pool_contract = web3.eth.contract(address=Web3.to_checksum_address(pool_address), abi=POOL_ABI)
    slot0 = pool_contract.functions.slot0().call()
    return slot0[0]

def decode_price(sqrt_price_x96: int, token0_decimals: int, token1_decimals: int) -> float:
    """Decodes Uniswap V3 sqrtPriceX96 into a human-readable price ratio."""
    price_q64 = (sqrt_price_x96 / (2**96)) ** 2
    # Adjust for decimal differences between token0 and token1
    decimal_adjustment = 10 ** (token0_decimals - token1_decimals)
    return price_q64 * decimal_adjustment

def calculate_triangular_return(amount_in: float, rate_a_b: float, rate_b_c: float, rate_c_a: float, fee: float = 0.003) -> float:
    """
    Calculates final token output after a 3-step trade cycle:
    Leg 1: Token A -> Token B (