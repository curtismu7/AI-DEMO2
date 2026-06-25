"""Unit tests for storage components."""

import asyncio
import pytest

from src.storage.token_cache import TokenCache


class TestTokenCache:
    """Test cases for TokenCache class."""

    @pytest.fixture
    def token_cache(self):
        """Create a TokenCache instance for testing."""
        return TokenCache(default_ttl_seconds=60)  # 1 minute default TTL

    @pytest.mark.asyncio
    async def test_set_and_get_data(self, token_cache):
        """Test setting and getting cached data."""
        test_data = {"access_token": "cached-token-123"}

        await token_cache.set("test_key", test_data)
        retrieved_data = await token_cache.get("test_key")

        assert retrieved_data == test_data

    @pytest.mark.asyncio
    async def test_get_nonexistent_key(self, token_cache):
        """Test getting data for a key that doesn't exist."""
        result = await token_cache.get("nonexistent_key")
        assert result is None

    @pytest.mark.asyncio
    async def test_data_expiration(self, token_cache):
        """Test that data expires after TTL."""
        test_data = {"token": "expiring-token"}

        # Set with very short TTL
        await token_cache.set("expiring_key", test_data, ttl_seconds=1)

        # Should be available immediately
        result = await token_cache.get("expiring_key")
        assert result == test_data

        # Wait for expiration
        await asyncio.sleep(1.1)

        # Should be None after expiration
        result = await token_cache.get("expiring_key")
        assert result is None

    @pytest.mark.asyncio
    async def test_delete_data(self, token_cache):
        """Test deleting cached data."""
        test_data = {"token": "delete-test"}

        await token_cache.set("delete_key", test_data)
        assert await token_cache.exists("delete_key")

        deleted = await token_cache.delete("delete_key")
        assert deleted is True
        assert not await token_cache.exists("delete_key")

        # Try to delete again
        deleted_again = await token_cache.delete("delete_key")
        assert deleted_again is False

    @pytest.mark.asyncio
    async def test_clear_cache(self, token_cache):
        """Test clearing all cached data."""
        test_data = {"token": "clear-test"}

        # Add some data
        await token_cache.set("clear1", test_data)
        await token_cache.set("clear2", test_data)
        await token_cache.set("clear3", test_data)

        # Clear all
        count = await token_cache.clear()
        assert count == 3

        # Verify empty
        assert not await token_cache.exists("clear1")
        assert not await token_cache.exists("clear2")
        assert not await token_cache.exists("clear3")

    @pytest.mark.asyncio
    async def test_cleanup_expired(self, token_cache):
        """Test cleaning up expired entries."""
        test_data = {"token": "cleanup-test"}

        # Add data with different TTLs
        await token_cache.set("short_ttl", test_data, ttl_seconds=1)
        await token_cache.set("long_ttl", test_data, ttl_seconds=60)

        # Wait for short TTL to expire
        await asyncio.sleep(1.1)

        # Cleanup expired entries
        cleaned_count = await token_cache.cleanup_expired()
        assert cleaned_count == 1

        # Verify only expired entry was removed
        assert not await token_cache.exists("short_ttl")
        assert await token_cache.exists("long_ttl")

    @pytest.mark.asyncio
    async def test_get_stats(self, token_cache):
        """Test getting cache statistics."""
        test_data = {"token": "stats-test"}

        # Add some data
        await token_cache.set("stats1", test_data, ttl_seconds=60)
        await token_cache.set("stats2", test_data, ttl_seconds=1)

        # Wait for one to expire
        await asyncio.sleep(1.1)

        stats = await token_cache.get_stats()

        assert stats["total_entries"] == 2
        assert stats["valid_entries"] == 1
        assert stats["expired_entries"] == 1
        assert stats["default_ttl_seconds"] == 60

    @pytest.mark.asyncio
    async def test_get_entry_info(self, token_cache):
        """Test getting entry information."""
        test_data = {"token": "info-test"}

        await token_cache.set("info_key", test_data, ttl_seconds=60)

        info = await token_cache.get_entry_info("info_key")

        assert info is not None
        assert "created_at" in info
        assert "expires_at" in info
        assert info["is_expired"] is False
        assert info["ttl_remaining_seconds"] > 0

        # Test nonexistent key
        info = await token_cache.get_entry_info("nonexistent")
        assert info is None

    @pytest.mark.asyncio
    async def test_data_isolation(self, token_cache):
        """Test that cached data is isolated from external modifications."""
        original_data = {"token": "isolation-test", "mutable_list": [1, 2, 3]}

        await token_cache.set("isolation_key", original_data)

        # Modify the original data
        original_data["token"] = "modified"
        original_data["mutable_list"].append(4)

        # Retrieved data should be unchanged
        retrieved_data = await token_cache.get("isolation_key")
        assert retrieved_data["token"] == "isolation-test"
        assert retrieved_data["mutable_list"] == [1, 2, 3]

        # Modify retrieved data
        retrieved_data["token"] = "modified-again"
        retrieved_data["mutable_list"].append(5)

        # Get again - should still be original
        retrieved_again = await token_cache.get("isolation_key")
        assert retrieved_again["token"] == "isolation-test"
        assert retrieved_again["mutable_list"] == [1, 2, 3]
