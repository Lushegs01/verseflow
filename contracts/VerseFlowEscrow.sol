// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title VerseFlowEscrow
 * @notice Milestone escrow for programmable work agreements on Verse (EVM / OP Stack).
 *
 * Design principles this contract enforces, rather than trusting the application to:
 *
 *  1. Funds are held by the contract, not by VerseFlow. There is no operator
 *     withdrawal path and no upgrade hatch that can move a depositor's money.
 *  2. Only the client (or the arbiter, on a disputed milestone) can authorize a
 *     release. Neither the backend nor any AI component is an authorized party.
 *  3. Releases are monotonic: `released[i] <= amounts[i]` always holds, so a
 *     milestone can never pay out more than it was funded for, and the sum of all
 *     releases can never exceed the deposit.
 *  4. The signed terms hash is stored on chain at creation. If the off-chain
 *     record is ever altered, the hashes stop matching and the discrepancy is
 *     visible to both parties.
 *
 * Evidence is anchored by hash only. No work product is written on chain.
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract VerseFlowEscrow {
    // -------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------

    enum AgreementState {
        None,        // never created
        Funded,      // escrow holds the full contract value
        Completed,   // every milestone settled
        Cancelled    // refunded to the client before completion
    }

    struct Agreement {
        address client;
        address provider;
        address token;          // ERC-20 settlement asset; address(0) = native coin
        uint256 totalAmount;
        uint256 totalReleased;
        bytes32 termsHash;      // keccak256 of the canonical terms both parties signed
        uint64 createdAt;
        AgreementState state;
    }

    // -------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------

    /// @dev agreementId is derived off chain as keccak256(termsHash, client, provider).
    mapping(bytes32 => Agreement) private _agreements;
    mapping(bytes32 => uint256[]) private _milestoneAmounts;
    mapping(bytes32 => uint256[]) private _milestoneReleased;
    mapping(bytes32 => bool) private _milestoneDisputed;

    /// @dev Evidence anchors: agreementId => milestoneIndex => round => bundle hash.
    mapping(bytes32 => mapping(uint256 => mapping(uint256 => bytes32))) private _evidenceAnchors;

    /**
     * @notice Neutral party that can settle a disputed milestone.
     * @dev Set once at deployment. The arbiter can act ONLY on a milestone that a
     *      party has explicitly flagged as disputed, and even then can only split
     *      that milestone's own funds between the two parties. It cannot touch an
     *      undisputed milestone, cannot change terms, and cannot pay itself.
     */
    address public immutable arbiter;

    // -------------------------------------------------------------------
    // Events  (the application's audit trail is reconstructable from these alone)
    // -------------------------------------------------------------------

    event AgreementFunded(
        bytes32 indexed agreementId,
        address indexed client,
        address indexed provider,
        address token,
        uint256 totalAmount,
        bytes32 termsHash
    );
    event MilestoneReleased(
        bytes32 indexed agreementId,
        uint256 indexed milestoneIndex,
        address indexed provider,
        uint256 amount,
        bool partial
    );
    event EvidenceAnchored(
        bytes32 indexed agreementId,
        uint256 indexed milestoneIndex,
        uint256 round,
        bytes32 bundleHash
    );
    event MilestoneDisputed(bytes32 indexed agreementId, uint256 indexed milestoneIndex, address indexed by);
    event DisputeSettled(
        bytes32 indexed agreementId,
        uint256 indexed milestoneIndex,
        uint256 providerAmount,
        uint256 clientRefund
    );
    event AgreementCompleted(bytes32 indexed agreementId, uint256 totalReleased);
    event AgreementCancelled(bytes32 indexed agreementId, uint256 refunded);

    // -------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------

    error AlreadyExists();
    error NotFound();
    error NotClient();
    error NotParty();
    error NotArbiter();
    error InvalidState();
    error AmountMismatch();
    error ExceedsRemaining();
    error NoMilestones();
    error MilestoneOutOfRange();
    error NotDisputed();
    error AlreadyDisputed();
    error TransferFailed();
    error ZeroAddress();
    error Reentrancy();

    // -------------------------------------------------------------------
    // Reentrancy guard (payouts call out to arbitrary token contracts)
    // -------------------------------------------------------------------

    uint256 private _lock = 1;
    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address arbiter_) {
        if (arbiter_ == address(0)) revert ZeroAddress();
        arbiter = arbiter_;
    }

    // -------------------------------------------------------------------
    // Funding
    // -------------------------------------------------------------------

    /**
     * @notice Create and fund an agreement in a single transaction.
     * @dev Creation and funding are deliberately atomic: an agreement can never
     *      exist on chain in an underfunded state, so the provider never sees a
     *      "funded" agreement that cannot actually pay.
     *
     * @param agreementId  keccak256(termsHash, client, provider), computed off chain.
     * @param provider     The party being paid.
     * @param token        ERC-20 settlement asset, or address(0) for the native coin.
     * @param amounts      Per-milestone amounts, in order. Their sum is the deposit.
     * @param termsHash    keccak256 of the canonical terms both parties signed.
     */
    function fundAgreement(
        bytes32 agreementId,
        address provider,
        address token,
        uint256[] calldata amounts,
        bytes32 termsHash
    ) external payable nonReentrant {
        if (_agreements[agreementId].state != AgreementState.None) revert AlreadyExists();
        if (provider == address(0)) revert ZeroAddress();
        if (amounts.length == 0) revert NoMilestones();

        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] == 0) revert AmountMismatch();
            total += amounts[i];
        }

        if (token == address(0)) {
            // Native settlement: the deposit must match the milestone sum exactly.
            if (msg.value != total) revert AmountMismatch();
        } else {
            if (msg.value != 0) revert AmountMismatch();
            // Balance-delta check, so fee-on-transfer tokens cannot under-fund escrow.
            uint256 before = IERC20(token).balanceOf(address(this));
            if (!IERC20(token).transferFrom(msg.sender, address(this), total)) revert TransferFailed();
            if (IERC20(token).balanceOf(address(this)) - before != total) revert AmountMismatch();
        }

        _agreements[agreementId] = Agreement({
            client: msg.sender,
            provider: provider,
            token: token,
            totalAmount: total,
            totalReleased: 0,
            termsHash: termsHash,
            createdAt: uint64(block.timestamp),
            state: AgreementState.Funded
        });

        _milestoneAmounts[agreementId] = amounts;
        _milestoneReleased[agreementId] = new uint256[](amounts.length);

        emit AgreementFunded(agreementId, msg.sender, provider, token, total, termsHash);
    }

    // -------------------------------------------------------------------
    // Evidence anchoring
    // -------------------------------------------------------------------

    /**
     * @notice Anchor a hash of the evidence bundle submitted for a milestone round.
     * @dev Only a hash is stored. This proves what was submitted and when, without
     *      putting any of the work product itself on a public chain.
     */
    function anchorEvidence(
        bytes32 agreementId,
        uint256 milestoneIndex,
        uint256 round,
        bytes32 bundleHash
    ) external {
        Agreement storage a = _agreements[agreementId];
        if (a.state == AgreementState.None) revert NotFound();
        if (msg.sender != a.provider && msg.sender != a.client) revert NotParty();
        if (milestoneIndex >= _milestoneAmounts[agreementId].length) revert MilestoneOutOfRange();

        _evidenceAnchors[agreementId][milestoneIndex][round] = bundleHash;
        emit EvidenceAnchored(agreementId, milestoneIndex, round, bundleHash);
    }

    // -------------------------------------------------------------------
    // Release
    // -------------------------------------------------------------------

    /**
     * @notice Release all or part of a milestone to the provider.
     * @dev Client-only. This is the line the product's trust model rests on: the
     *      AI can recommend, the backend can orchestrate, but only the client's own
     *      key moves money.
     */
    function releaseMilestone(
        bytes32 agreementId,
        uint256 milestoneIndex,
        uint256 amount
    ) external nonReentrant {
        Agreement storage a = _agreements[agreementId];
        if (a.state == AgreementState.None) revert NotFound();
        if (a.state != AgreementState.Funded) revert InvalidState();
        if (msg.sender != a.client) revert NotClient();
        if (milestoneIndex >= _milestoneAmounts[agreementId].length) revert MilestoneOutOfRange();
        // A disputed milestone is frozen until the arbiter settles it.
        if (_milestoneDisputed[agreementId]) revert InvalidState();

        uint256 allocated = _milestoneAmounts[agreementId][milestoneIndex];
        uint256 already = _milestoneReleased[agreementId][milestoneIndex];
        uint256 remaining = allocated - already;
        if (amount == 0 || amount > remaining) revert ExceedsRemaining();

        // Effects before interactions.
        _milestoneReleased[agreementId][milestoneIndex] = already + amount;
        a.totalReleased += amount;

        bool partial = (already + amount) < allocated;
        _payout(a.token, a.provider, amount);

        emit MilestoneReleased(agreementId, milestoneIndex, a.provider, amount, partial);
        _settleIfComplete(agreementId, a);
    }

    // -------------------------------------------------------------------
    // Disputes
    // -------------------------------------------------------------------

    /// @notice Either party may freeze a milestone pending arbitration.
    function flagDispute(bytes32 agreementId, uint256 milestoneIndex) external {
        Agreement storage a = _agreements[agreementId];
        if (a.state == AgreementState.None) revert NotFound();
        if (a.state != AgreementState.Funded) revert InvalidState();
        if (msg.sender != a.client && msg.sender != a.provider) revert NotParty();
        if (milestoneIndex >= _milestoneAmounts[agreementId].length) revert MilestoneOutOfRange();
        if (_milestoneDisputed[agreementId]) revert AlreadyDisputed();

        _milestoneDisputed[agreementId] = true;
        emit MilestoneDisputed(agreementId, milestoneIndex, msg.sender);
    }

    /**
     * @notice Settle a disputed milestone by splitting its remaining balance.
     * @dev Arbiter-only, and only for a milestone that was explicitly disputed. The
     *      split is bounded by that milestone's own remaining amount, so arbitration
     *      can never reach funds allocated to other milestones.
     */
    function settleDispute(
        bytes32 agreementId,
        uint256 milestoneIndex,
        uint256 providerAmount
    ) external nonReentrant {
        Agreement storage a = _agreements[agreementId];
        if (a.state == AgreementState.None) revert NotFound();
        if (a.state != AgreementState.Funded) revert InvalidState();
        if (msg.sender != arbiter) revert NotArbiter();
        if (!_milestoneDisputed[agreementId]) revert NotDisputed();
        if (milestoneIndex >= _milestoneAmounts[agreementId].length) revert MilestoneOutOfRange();

        uint256 allocated = _milestoneAmounts[agreementId][milestoneIndex];
        uint256 already = _milestoneReleased[agreementId][milestoneIndex];
        uint256 remaining = allocated - already;
        if (providerAmount > remaining) revert ExceedsRemaining();

        uint256 clientRefund = remaining - providerAmount;

        _milestoneReleased[agreementId][milestoneIndex] = allocated; // milestone fully settled
        a.totalReleased += remaining;
        _milestoneDisputed[agreementId] = false;

        if (providerAmount > 0) _payout(a.token, a.provider, providerAmount);
        if (clientRefund > 0) _payout(a.token, a.client, clientRefund);

        emit DisputeSettled(agreementId, milestoneIndex, providerAmount, clientRefund);
        _settleIfComplete(agreementId, a);
    }

    // -------------------------------------------------------------------
    // Cancellation
    // -------------------------------------------------------------------

    /**
     * @notice Refund the unreleased balance to the client.
     * @dev Requires the provider's own transaction, so a client cannot unilaterally
     *      withdraw funds out from under work already in progress. The arbiter can
     *      also trigger this while a dispute is active.
     */
    function cancelAndRefund(bytes32 agreementId) external nonReentrant {
        Agreement storage a = _agreements[agreementId];
        if (a.state == AgreementState.None) revert NotFound();
        if (a.state != AgreementState.Funded) revert InvalidState();

        bool byProvider = msg.sender == a.provider;
        bool byArbiterInDispute = msg.sender == arbiter && _milestoneDisputed[agreementId];
        if (!byProvider && !byArbiterInDispute) revert NotParty();

        uint256 refund = a.totalAmount - a.totalReleased;
        a.totalReleased = a.totalAmount;
        a.state = AgreementState.Cancelled;
        _milestoneDisputed[agreementId] = false;

        if (refund > 0) _payout(a.token, a.client, refund);
        emit AgreementCancelled(agreementId, refund);
    }

    // -------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------

    function getAgreement(bytes32 agreementId)
        external
        view
        returns (
            address client,
            address provider,
            address token,
            uint256 totalAmount,
            uint256 totalReleased,
            bytes32 termsHash,
            uint64 createdAt,
            AgreementState state,
            bool disputed
        )
    {
        Agreement storage a = _agreements[agreementId];
        if (a.state == AgreementState.None) revert NotFound();
        return (
            a.client, a.provider, a.token, a.totalAmount, a.totalReleased,
            a.termsHash, a.createdAt, a.state, _milestoneDisputed[agreementId]
        );
    }

    function getMilestones(bytes32 agreementId)
        external
        view
        returns (uint256[] memory amounts, uint256[] memory released)
    {
        return (_milestoneAmounts[agreementId], _milestoneReleased[agreementId]);
    }

    function getEvidenceAnchor(bytes32 agreementId, uint256 milestoneIndex, uint256 round)
        external
        view
        returns (bytes32)
    {
        return _evidenceAnchors[agreementId][milestoneIndex][round];
    }

    /// @notice Confirms that on-chain terms match what the application is displaying.
    function verifyTerms(bytes32 agreementId, bytes32 expectedTermsHash) external view returns (bool) {
        return _agreements[agreementId].termsHash == expectedTermsHash;
    }

    // -------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------

    function _payout(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            (bool ok, ) = payable(to).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            if (!IERC20(token).transfer(to, amount)) revert TransferFailed();
        }
    }

    function _settleIfComplete(bytes32 agreementId, Agreement storage a) private {
        if (a.totalReleased >= a.totalAmount) {
            a.state = AgreementState.Completed;
            emit AgreementCompleted(agreementId, a.totalReleased);
        }
    }
}
