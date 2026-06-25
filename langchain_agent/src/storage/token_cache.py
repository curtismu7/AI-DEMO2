"""In-memory token caching with TTL support."""

import asyncio
import copy
from typing import Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass


@dataclass
class CacheEntry:
    """Cache entry with data and expiration information."""
    data: Dict[str, Any]
    expires_at: datetime
    created_at: datetime


class TokenCache:
    """In-memory cache for tokens with automatic expiration."""
    
    def __init__(self, default_ttl_seconds: int = 3600):
        """
        Initialize token cache.
        
        Args:
            default_ttl_seconds: Default time-to-live for cache entries in seconds
        """
        self.default_ttl_seconds = default_ttl_seconds
        self._cache: Dict[str, CacheEntry] = {}
        self._lock = asyncio.Lock()
    
    async def get(self, key: str) -> Optional[Dict[str, Any]]:
        """
        Get cached data if it exists and hasn't expired.
        
        Args:
            key: Cache key
            
        Returns:
            Cached data or None if not found or expired
        """
        async with self._lock:
            entry = self._cache.get(key)
            
            if entry is None:
                return None
            
            # Check if entry has expired
            if datetime.now(timezone.utc) >= entry.expires_at:
                # Remove expired entry
                del self._cache[key]
                return None
            
            return copy.deepcopy(entry.data)  # Return a deep copy to prevent external modification
    
    async def set(self, key: str, data: Dict[str, Any], ttl_seconds: Optional[int] = None) -> None:
        """
        Store data in cache with TTL.
        
        Args:
            key: Cache key
            data: Data to cache
            ttl_seconds: Time-to-live in seconds. Uses default if not provided.
        """
        async with self._lock:
            ttl = ttl_seconds or self.default_ttl_seconds
            now = datetime.now(timezone.utc)
            expires_at = now + timedelta(seconds=ttl)
            
            entry = CacheEntry(
                data=copy.deepcopy(data),  # Store a deep copy to prevent external modification
                expires_at=expires_at,
                created_at=now
            )
            
            self._cache[key] = entry
    
    async def delete(self, key: str) -> bool:
        """
        Delete cached data.
        
        Args:
            key: Cache key
            
        Returns:
            True if key was deleted, False if key didn't exist
        """
        async with self._lock:
            if key in self._cache:
                del self._cache[key]
                return True
            return False
    
    async def exists(self, key: str) -> bool:
        """
        Check if a key exists in cache and hasn't expired.
        
        Args:
            key: Cache key
            
        Returns:
            True if key exists and is valid, False otherwise
        """
        data = await self.get(key)
        return data is not None
    
    async def clear(self) -> int:
        """
        Clear all cached data.
        
        Returns:
            Number of entries cleared
        """
        async with self._lock:
            count = len(self._cache)
            self._cache.clear()
            return count
    
    async def cleanup_expired(self) -> int:
        """
        Remove all expired entries from cache.
        
        Returns:
            Number of expired entries removed
        """
        async with self._lock:
            now = datetime.now(timezone.utc)
            expired_keys = [
                key for key, entry in self._cache.items()
                if now >= entry.expires_at
            ]
            
            for key in expired_keys:
                del self._cache[key]
            
            return len(expired_keys)
    
    async def get_stats(self) -> Dict[str, Any]:
        """
        Get cache statistics.
        
        Returns:
            Dictionary with cache statistics
        """
        async with self._lock:
            now = datetime.now(timezone.utc)
            total_entries = len(self._cache)
            expired_entries = sum(
                1 for entry in self._cache.values()
                if now >= entry.expires_at
            )
            valid_entries = total_entries - expired_entries
            
            return {
                "total_entries": total_entries,
                "valid_entries": valid_entries,
                "expired_entries": expired_entries,
                "default_ttl_seconds": self.default_ttl_seconds
            }
    
    async def get_entry_info(self, key: str) -> Optional[Dict[str, Any]]:
        """
        Get information about a cache entry without returning the data.
        
        Args:
            key: Cache key
            
        Returns:
            Entry information or None if not found
        """
        async with self._lock:
            entry = self._cache.get(key)
            
            if entry is None:
                return None
            
            now = datetime.now(timezone.utc)
            is_expired = now >= entry.expires_at
            
            return {
                "created_at": entry.created_at.isoformat(),
                "expires_at": entry.expires_at.isoformat(),
                "is_expired": is_expired,
                "ttl_remaining_seconds": max(0, (entry.expires_at - now).total_seconds()) if not is_expired else 0
            }