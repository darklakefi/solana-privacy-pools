"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { WalletButton } from "@/components/WalletButton";
import { NetworkIndicator } from "@/components/NetworkIndicator";
import { useWallet } from "@solana/wallet-adapter-react";

export default function Home() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState("SOL");
  const [activityTab, setActivityTab] = useState("global");
  const { connected, publicKey } = useWallet();

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="border-b border-primary/10 bg-black/95 backdrop-blur">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link href="/" className="flex items-center">
              <Image 
                src="/darklake-logo.svg" 
                alt="Darklake" 
                width={120} 
                height={98}
                className="h-10 w-auto"
              />
            </Link>

            {/* Menu and Connect */}
            <div className="flex items-center space-x-4">
              <NetworkIndicator />
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <WalletButton />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="grid gap-6">
          {/* Pool Accounts Card */}
          <div className="bg-dark border border-primary/20 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <h2 className="font-sans text-lg text-white">Pool Accounts</h2>
                <div className="group relative">
                  <svg className="w-4 h-4 text-gray-400 cursor-help" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block bg-black border border-primary/20 rounded-lg p-2 text-xs text-gray-300 whitespace-nowrap z-10">
                    View and manage your pool deposits
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {/* Token Selector */}
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
                  <span className="text-primary text-xs font-mono">SOL</span>
                </div>
                <select 
                  value={selectedToken}
                  onChange={(e) => setSelectedToken(e.target.value)}
                  className="bg-black border border-primary/20 rounded-lg px-3 py-2 text-white flex-1 focus:outline-none focus:border-primary"
                >
                  <option value="SOL">SOL</option>
                  <option value="USDC">USDC</option>
                  <option value="USDT">USDT</option>
                </select>
                <button className="p-2 text-gray-400 hover:text-primary transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {/* Connect Wallet Message or Account Info */}
              {!connected ? (
                <div className="text-center py-8 text-gray-400">
                  Connect Wallet to Sign in and Deposit
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-black border border-primary/10 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-gray-400 text-sm">Connected Account</span>
                      <span className="font-mono text-primary text-xs">
                        {publicKey?.toBase58().slice(0, 4)}...{publicKey?.toBase58().slice(-4)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 text-sm">Balance</span>
                      <span className="font-mono text-white">0.00 SOL</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <button className="bg-primary text-black px-4 py-3 rounded-lg font-sans hover:bg-primary-dark transition-colors">
                      Deposit
                    </button>
                    <button className="border border-primary text-primary px-4 py-3 rounded-lg font-sans hover:bg-primary/10 transition-colors">
                      Withdraw
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Global Pool Card */}
            <div className="bg-dark border border-primary/20 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <h2 className="font-sans text-lg text-white">Global Pool</h2>
                  <div className="group relative">
                    <svg className="w-4 h-4 text-gray-400 cursor-help" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block bg-black border border-primary/20 rounded-lg p-2 text-xs text-gray-300 whitespace-nowrap z-10">
                      Global pool statistics
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="text-gray-400 text-sm mb-1">Deposits made:</p>
                  <p className="font-mono text-2xl text-primary">0</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm mb-1">In Privacy Pools:</p>
                  <p className="font-mono text-2xl text-primary">0.00 SOL</p>
                </div>
              </div>
            </div>

            {/* Activity Card */}
            <div className="bg-dark border border-primary/20 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <h2 className="font-sans text-lg text-white">Activity</h2>
                  <div className="group relative">
                    <svg className="w-4 h-4 text-gray-400 cursor-help" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block bg-black border border-primary/20 rounded-lg p-2 text-xs text-gray-300 whitespace-nowrap z-10">
                      Transaction activity
                    </div>
                  </div>
                </div>
              </div>

              {/* Activity Tabs */}
              <div className="flex space-x-2 mb-4">
                <button
                  onClick={() => setActivityTab("global")}
                  className={`px-4 py-2 rounded-lg text-sm font-sans transition-colors ${
                    activityTab === "global"
                      ? "bg-primary text-black"
                      : "bg-black border border-primary/20 text-gray-400 hover:text-primary"
                  }`}
                >
                  Global
                </button>
                <button
                  onClick={() => setActivityTab("personal")}
                  disabled
                  className="px-4 py-2 rounded-lg text-sm font-sans bg-black border border-primary/10 text-gray-600 cursor-not-allowed"
                >
                  Personal
                </button>
                <button
                  disabled
                  className="ml-auto px-4 py-2 rounded-lg text-sm font-sans bg-black border border-primary/10 text-gray-600 cursor-not-allowed flex items-center space-x-1"
                >
                  <span>View All</span>
                </button>
              </div>

              {/* Activity Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-primary/10">
                      <th className="text-left py-2 text-gray-400 font-light">Action</th>
                      <th className="text-left py-2 text-gray-400 font-light">Value</th>
                      <th className="text-left py-2 text-gray-400 font-light">Time</th>
                      <th className="text-left py-2 text-gray-400 font-light">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={4} className="text-center py-8 text-gray-500">
                        <div className="flex items-center justify-center space-x-2">
                          <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                          <div className="w-2 h-2 bg-primary rounded-full animate-pulse delay-100"></div>
                          <div className="w-2 h-2 bg-primary rounded-full animate-pulse delay-200"></div>
                        </div>
                        <p className="mt-2">Loading...</p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Links */}
        <footer className="mt-12 py-6 border-t border-primary/10">
          <nav className="flex flex-wrap items-center justify-center gap-4 text-sm">
            <Link href="https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4563364" target="_blank" className="text-gray-400 hover:text-primary transition-colors">
              White Paper
            </Link>
            <span className="text-gray-600">|</span>
            <Link href="https://docs.privacypools.com" target="_blank" className="text-gray-400 hover:text-primary transition-colors">
              Docs
            </Link>
            <span className="text-gray-600">|</span>
            <Link href="https://x.com/darklakefi" target="_blank" className="text-gray-400 hover:text-primary transition-colors">
              X
            </Link>
            <span className="text-gray-600">|</span>
            <Link href="https://docs.google.com/forms" target="_blank" className="text-gray-400 hover:text-primary transition-colors">
              Support
            </Link>
            <span className="text-gray-600">|</span>
            <Link href="https://github.com/darklakefi" target="_blank" className="text-gray-400 hover:text-primary transition-colors">
              Github
            </Link>
            <span className="text-gray-600">|</span>
            <button className="text-gray-400 hover:text-primary transition-colors">
              Newsletter
            </button>
          </nav>
        </footer>
      </main>

      {/* Report Bug Button */}
      <button className="fixed bottom-6 right-6 bg-primary text-black px-4 py-2 rounded-lg font-sans text-sm hover:bg-primary-dark transition-colors flex items-center space-x-2 shadow-lg">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Report a Bug</span>
      </button>
    </div>
  );
}