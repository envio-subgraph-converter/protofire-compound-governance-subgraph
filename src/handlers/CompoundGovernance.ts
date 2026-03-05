import { GovernorAlpha, CompoundToken, BigDecimal } from "generated";

// ============= Constants =============

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BD = new BigDecimal(0);
const ZERO_BI = BigInt(0);

// ============= Helper Functions =============

function toDecimal(value: bigint): BigDecimal {
  if (value === ZERO_BI) return ZERO_BD;
  return new BigDecimal(value.toString()).div(new BigDecimal("1e18"));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getGovernanceEntity(context: any) {
  let governance = await context.Governance.get("GOVERNANCE");
  if (governance === undefined) {
    governance = {
      id: "GOVERNANCE",
      proposals: ZERO_BI,
      currentTokenHolders: ZERO_BI,
      currentDelegates: ZERO_BI,
      totalTokenHolders: ZERO_BI,
      totalDelegates: ZERO_BI,
      delegatedVotesRaw: ZERO_BI,
      delegatedVotes: ZERO_BD,
      proposalsQueued: ZERO_BI,
    };
    context.Governance.set(governance);
  }
  return governance;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getOrCreateTokenHolder(id: string, context: any) {
  let tokenHolder = await context.TokenHolder.get(id);
  if (tokenHolder === undefined) {
    tokenHolder = {
      id,
      delegate_id: undefined,
      tokenBalanceRaw: ZERO_BI,
      tokenBalance: ZERO_BD,
      totalTokensHeldRaw: ZERO_BI,
      totalTokensHeld: ZERO_BD,
    };
    if (id.toLowerCase() !== ZERO_ADDRESS) {
      const governance = await getGovernanceEntity(context);
      context.Governance.set({
        ...governance,
        totalTokenHolders: governance.totalTokenHolders + BigInt(1),
      });
    }
    context.TokenHolder.set(tokenHolder);
  }
  return tokenHolder;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getOrCreateDelegate(id: string, context: any) {
  let delegate = await context.Delegate.get(id);
  if (delegate === undefined) {
    delegate = {
      id,
      delegatedVotesRaw: ZERO_BI,
      delegatedVotes: ZERO_BD,
      tokenHoldersRepresentedAmount: 0,
    };
    if (id.toLowerCase() !== ZERO_ADDRESS) {
      const governance = await getGovernanceEntity(context);
      context.Governance.set({
        ...governance,
        totalDelegates: governance.totalDelegates + BigInt(1),
      });
    }
    context.Delegate.set(delegate);
  }
  return delegate;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getOrCreateProposal(id: string, context: any) {
  let proposal = await context.Proposal.get(id);
  if (proposal === undefined) {
    const governance = await getGovernanceEntity(context);
    context.Governance.set({
      ...governance,
      proposals: governance.proposals + BigInt(1),
    });
    proposal = {
      id,
      proposer_id: "",
      targets: [] as string[],
      values: [] as bigint[],
      signatures: [] as string[],
      calldatas: [] as string[],
      startBlock: ZERO_BI,
      endBlock: ZERO_BI,
      description: "",
      status: "PENDING" as const,
      executionETA: undefined,
    };
    context.Proposal.set(proposal);
  }
  return proposal;
}

// ============= GovernorAlpha Event Handlers =============

GovernorAlpha.ProposalCreated.handler(async ({ event, context }) => {
  const proposalId = event.params.id.toString();
  const proposal = await getOrCreateProposal(proposalId, context);
  const proposer = await getOrCreateDelegate(
    event.params.proposer.toLowerCase(),
    context
  );

  const status =
    BigInt(event.block.number) >= event.params.startBlock
      ? ("ACTIVE" as const)
      : ("PENDING" as const);

  context.Proposal.set({
    ...proposal,
    proposer_id: proposer.id,
    targets: [...event.params.targets],
    values: [...event.params.values],
    signatures: [...event.params.signatures],
    calldatas: [...event.params.calldatas],
    startBlock: event.params.startBlock,
    endBlock: event.params.endBlock,
    description: event.params.description,
    status,
    executionETA: undefined,
  });
});

GovernorAlpha.ProposalCanceled.handler(async ({ event, context }) => {
  const proposalId = event.params.id.toString();
  const proposal = await getOrCreateProposal(proposalId, context);
  context.Proposal.set({ ...proposal, status: "CANCELLED" as const });
});

GovernorAlpha.ProposalQueued.handler(async ({ event, context }) => {
  const proposalId = event.params.id.toString();
  const proposal = await getOrCreateProposal(proposalId, context);
  const governance = await getGovernanceEntity(context);

  context.Proposal.set({
    ...proposal,
    status: "QUEUED" as const,
    executionETA: event.params.eta,
  });
  context.Governance.set({
    ...governance,
    proposalsQueued: governance.proposalsQueued + BigInt(1),
  });
});

GovernorAlpha.ProposalExecuted.handler(async ({ event, context }) => {
  const proposalId = event.params.id.toString();
  const proposal = await getOrCreateProposal(proposalId, context);
  const governance = await getGovernanceEntity(context);

  context.Proposal.set({
    ...proposal,
    status: "EXECUTED" as const,
    executionETA: undefined,
  });
  context.Governance.set({
    ...governance,
    proposalsQueued: governance.proposalsQueued - BigInt(1),
  });
});

GovernorAlpha.VoteCast.handler(async ({ event, context }) => {
  const proposalId = event.params.proposalId.toString();
  const proposal = await getOrCreateProposal(proposalId, context);
  const voteId =
    event.params.voter.toLowerCase() + "-" + proposalId;
  const voter = await getOrCreateDelegate(
    event.params.voter.toLowerCase(),
    context
  );

  context.Vote.set({
    id: voteId,
    proposal_id: proposalId,
    voter_id: voter.id,
    votesRaw: event.params.votes,
    votes: toDecimal(event.params.votes),
    support: event.params.support,
  });

  if (proposal.status === "PENDING") {
    context.Proposal.set({ ...proposal, status: "ACTIVE" as const });
  }
});

// ============= CompoundToken Event Handlers =============

CompoundToken.DelegateChanged.handler(async ({ event, context }) => {
  const tokenHolder = await getOrCreateTokenHolder(
    event.params.delegator.toLowerCase(),
    context
  );
  const previousDelegate = await getOrCreateDelegate(
    event.params.fromDelegate.toLowerCase(),
    context
  );
  const newDelegate = await getOrCreateDelegate(
    event.params.toDelegate.toLowerCase(),
    context
  );

  context.TokenHolder.set({ ...tokenHolder, delegate_id: newDelegate.id });
  context.Delegate.set({
    ...previousDelegate,
    tokenHoldersRepresentedAmount:
      previousDelegate.tokenHoldersRepresentedAmount - 1,
  });
  context.Delegate.set({
    ...newDelegate,
    tokenHoldersRepresentedAmount:
      newDelegate.tokenHoldersRepresentedAmount + 1,
  });
});

CompoundToken.DelegateVotesChanged.handler(async ({ event, context }) => {
  const governance = await getGovernanceEntity(context);
  const delegate = await getOrCreateDelegate(
    event.params.delegate.toLowerCase(),
    context
  );

  const votesDifference =
    event.params.newBalance - event.params.previousBalance;

  context.Delegate.set({
    ...delegate,
    delegatedVotesRaw: event.params.newBalance,
    delegatedVotes: toDecimal(event.params.newBalance),
  });

  let updatedGovernance = { ...governance };

  if (
    event.params.previousBalance === ZERO_BI &&
    event.params.newBalance > ZERO_BI
  ) {
    updatedGovernance = {
      ...updatedGovernance,
      currentDelegates: updatedGovernance.currentDelegates + BigInt(1),
    };
  }
  if (event.params.newBalance === ZERO_BI) {
    updatedGovernance = {
      ...updatedGovernance,
      currentDelegates: updatedGovernance.currentDelegates - BigInt(1),
    };
  }

  const newDelegatedVotesRaw =
    updatedGovernance.delegatedVotesRaw + votesDifference;
  context.Governance.set({
    ...updatedGovernance,
    delegatedVotesRaw: newDelegatedVotesRaw,
    delegatedVotes: toDecimal(newDelegatedVotesRaw),
  });
});

CompoundToken.Transfer.handler(async ({ event, context }) => {
  const fromHolder = await getOrCreateTokenHolder(
    event.params.from.toLowerCase(),
    context
  );
  const toHolder = await getOrCreateTokenHolder(
    event.params.to.toLowerCase(),
    context
  );
  let governance = await getGovernanceEntity(context);

  // Handle fromHolder (skip if minting from zero address)
  if (event.params.from.toLowerCase() !== ZERO_ADDRESS) {
    const fromHolderPreviousBalance = fromHolder.tokenBalanceRaw;
    const newFromBalance = fromHolder.tokenBalanceRaw - event.params.amount;

    context.TokenHolder.set({
      ...fromHolder,
      tokenBalanceRaw: newFromBalance,
      tokenBalance: toDecimal(newFromBalance),
    });

    if (
      newFromBalance === ZERO_BI &&
      fromHolderPreviousBalance > ZERO_BI
    ) {
      governance = {
        ...governance,
        currentTokenHolders: governance.currentTokenHolders - BigInt(1),
      };
      context.Governance.set(governance);
    } else if (
      newFromBalance > ZERO_BI &&
      fromHolderPreviousBalance === ZERO_BI
    ) {
      governance = {
        ...governance,
        currentTokenHolders: governance.currentTokenHolders + BigInt(1),
      };
      context.Governance.set(governance);
    }
  }

  // Handle toHolder
  const toHolderPreviousBalance = toHolder.tokenBalanceRaw;
  const newToBalance = toHolder.tokenBalanceRaw + event.params.amount;
  const newTotalHeld = toHolder.totalTokensHeldRaw + event.params.amount;

  context.TokenHolder.set({
    ...toHolder,
    tokenBalanceRaw: newToBalance,
    tokenBalance: toDecimal(newToBalance),
    totalTokensHeldRaw: newTotalHeld,
    totalTokensHeld: toDecimal(newTotalHeld),
  });

  if (newToBalance === ZERO_BI && toHolderPreviousBalance > ZERO_BI) {
    governance = {
      ...governance,
      currentTokenHolders: governance.currentTokenHolders - BigInt(1),
    };
    context.Governance.set(governance);
  } else if (newToBalance > ZERO_BI && toHolderPreviousBalance === ZERO_BI) {
    governance = {
      ...governance,
      currentTokenHolders: governance.currentTokenHolders + BigInt(1),
    };
    context.Governance.set(governance);
  }
});
