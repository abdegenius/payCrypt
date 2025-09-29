import Balance from "../models/Balance.js";
import Token from "../models/Token.js";
import starknet from "../starknet-contract.js";
import { shortString } from "starknet";
import { from18Decimals } from "../utils/amount.js";
import redis from "../config/redis.js";

export const createBalance = async (req, res) => {
  try {
    const balanceData = {
      ...req.body,
      user_id: req.user.id,
    };

    const balance = await Balance.create(balanceData);
    res.status(201).json(balance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getBalances = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const balances = await Balance.getAll(
      Number.parseInt(limit),
      Number.parseInt(offset)
    );
    res.json(balances);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getBalanceByUser = async (req, res) => {
  try {
    const { id } = req.user;
    const _balances = await Balance.getByUser(user.id);
    for (const balance of _balances) {
      const token = await Token.findById(balance.token_id);

      if (token.symbol === "STRK") {
        const contract = await starknet.getContract();
        const userTag = shortString.encodeShortString(user.tag);

        // bal will likely be a BigInt
        const bal = await contract.get_tag_wallet_balance(
          userTag,
          "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
        );

        const balStr = from18Decimals(bal.toString());
        const balBig = from18Decimals(BigInt(bal));

        if (balStr !== balance.amount) {
          const crypto_value = balStr;
          const usdPrice = token.price;
          const usd_value = Number(balBig) * (usdPrice ?? 1);

          await Balance.update(balance.id, {
            amount: crypto_value,
            usd_value,
          });
        }
      }
    }
    const ngnPrice = redis.get(NGN_KEY) ?? 1600;
    const balances = await Balance.getByUser(id);
    for (const balance of balances) {
      balance.ngn_value = (balance.usd_value || 0) * ngnPrice;
    }
    res.json(balances);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getBalanceById = async (req, res) => {
  try {
    const { id } = req.params;
    const balance = await Balance.findById(id);

    if (!balance) {
      return res.status(400).json({ error: "Balance not found" });
    }
    // Only allow balance owner to view
    if (balance.user_id !== req.user.id) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    res.json(balance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateBalance = async (req, res) => {
  try {
    const { id } = req.params;
    const balance = await Balance.findById(id);

    if (!balance) {
      return res.status(400).json({ error: "Balance not found" });
    }

    // Only allow balance owner to update
    if (balance.user_id !== req.user.id) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const updatedBalance = await Balance.update(id, req.body);
    res.json(updatedBalance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteBalance = async (req, res) => {
  try {
    const { id } = req.params;
    const balance = await Balance.findById(id);

    if (!balance) {
      return res.status(400).json({ error: "Balance not found" });
    }

    // Only allow balance owner to delete
    if (balance.user_id !== req.user.id) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    await Balance.delete(id);
    res.json({ message: "Balance deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createUserBalance = async (user_id, tag) => {
  try {
    const tokens = await Token.getAll();
    const balances = [];

    // Get contract only once
    const contract = tokens.some((t) => t.symbol === "STRK")
      ? await starknet.getContract()
      : null;

    for (const token of tokens) {
      let address = null;

      if (token.symbol === "STRK" && contract) {
        // Write tx (register tag)
        const tx = await contract.register_tag(tag);
        await starknet.provider.waitForTransaction(tx.transaction_hash);

        // Read wallet address
        const feltAddress = await contract.get_tag_wallet_address(tag);

        address = `0x${feltAddress.toString(16)}`;
        console.log("Wallet address:", address);
      }

      const balance = await Balance.create({
        user_id,
        token_id: token.id,
        address,
      });

      balances.push(balance);
    }

    return balances;
  } catch (error) {
    console.error("❌ createUserBalance failed:", error);
    throw error; // let the controller handle the HTTP response
  }
};
