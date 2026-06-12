'use client';
import { useState } from 'react';

export function NewsletterForm() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="flex items-center justify-center gap-2 text-emerald-400 text-sm font-medium py-3">
        <span>&#10003;</span>
        <span>You&rsquo;re on the list &mdash; thanks!</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
      <input
        type="email"
        required
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="your@email.com"
        className="flex-1 px-4 py-3 rounded-xl bg-gray-700 border border-gray-600 text-white placeholder:text-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
      />
      <button
        type="submit"
        className="px-6 py-3 bg-accent text-white font-semibold rounded-xl text-sm hover:bg-accent-light transition-colors whitespace-nowrap"
      >
        Subscribe
      </button>
    </form>
  );
}