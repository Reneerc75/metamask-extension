import { InternalAccount } from '@metamask/keyring-api';
import { TransactionParams } from '@metamask/eth-json-rpc-middleware';
import {
  TransactionController,
  TransactionMeta,
  TransactionType,
} from '@metamask/transaction-controller';
import { UserOperationController } from '@metamask/user-operation-controller';
import { cloneDeep } from 'lodash';
import {
  AddDappTransactionRequest,
  AddTransactionOptions,
  AddTransactionRequest,
  addDappTransaction,
  addTransaction,
} from './util';

const TRANSACTION_PARAMS_MOCK: TransactionParams = {
  from: '0x1',
};

const TRANSACTION_OPTIONS_MOCK: AddTransactionOptions = {
  actionId: 'mockActionId',
  origin: 'mockOrigin',
  requireApproval: false,
  type: TransactionType.simpleSend,
};

const DAPP_REQUEST_MOCK = {
  id: TRANSACTION_OPTIONS_MOCK.actionId,
  method: 'eth_sendTransaction',
  origin: TRANSACTION_OPTIONS_MOCK.origin,
  securityAlertResponse: { test: 'value' },
};

const TRANSACTION_META_MOCK: TransactionMeta = {
  id: 'testId',
  hash: 'testHash',
} as TransactionMeta;

const TRANSACTION_REQUEST_MOCK: AddTransactionRequest = {
  networkClientId: 'mockNetworkClientId',
  selectedAccount: {
    type: 'eip155:eoa',
  } as InternalAccount,
  transactionParams: TRANSACTION_PARAMS_MOCK,
  transactionOptions: TRANSACTION_OPTIONS_MOCK,
  waitForSubmit: false,
} as AddTransactionRequest;

function createTransactionControllerMock() {
  return {
    addTransaction: jest.fn(),
    state: { transactions: [] },
  } as unknown as jest.Mocked<TransactionController>;
}

function createUserOperationControllerMock() {
  return {
    addUserOperationFromTransaction: jest.fn(),
    startPollingByNetworkClientId: jest.fn(),
  } as unknown as jest.Mocked<UserOperationController>;
}

async function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('Transaction Utils', () => {
  let request: AddTransactionRequest;
  let dappRequest: AddDappTransactionRequest;
  let transactionController: jest.Mocked<TransactionController>;
  let userOperationController: jest.Mocked<UserOperationController>;

  beforeEach(() => {
    jest.resetAllMocks();

    request = cloneDeep(TRANSACTION_REQUEST_MOCK);
    transactionController = createTransactionControllerMock();
    userOperationController = createUserOperationControllerMock();

    transactionController.addTransaction.mockResolvedValue({
      result: Promise.resolve('testHash'),
      transactionMeta: TRANSACTION_META_MOCK,
    });

    transactionController.state.transactions.push(TRANSACTION_META_MOCK);

    userOperationController.addUserOperationFromTransaction.mockResolvedValue({
      id: TRANSACTION_META_MOCK.id,
      hash: jest.fn().mockResolvedValue({}),
      transactionHash: jest.fn().mockResolvedValue(TRANSACTION_META_MOCK.hash),
    });

    request.transactionController = transactionController;
    request.userOperationController = userOperationController;

    dappRequest = {
      ...request,
      dappRequest: DAPP_REQUEST_MOCK,
    };
  });

  describe('addTransaction', () => {
    describe('if selected account is EOA', () => {
      it('adds transaction', async () => {
        await addTransaction(request);

        expect(
          request.transactionController.addTransaction,
        ).toHaveBeenCalledTimes(1);
        expect(
          request.transactionController.addTransaction,
        ).toHaveBeenCalledWith(
          TRANSACTION_PARAMS_MOCK,
          TRANSACTION_OPTIONS_MOCK,
        );
      });

      it('returns transaction meta', async () => {
        const transactionMeta = await addTransaction(request);
        expect(transactionMeta).toStrictEqual(TRANSACTION_META_MOCK);
      });

      it('does not throw if result promise fails if waitForSubmit is false', async () => {
        transactionController.addTransaction.mockResolvedValue({
          result: Promise.reject(new Error('Test Error')),
          transactionMeta: TRANSACTION_META_MOCK,
        });

        await expect(addTransaction(request)).resolves.toBeTruthy();
      });

      it('throws if result promise fails if waitForSubmit is true', async () => {
        request.waitForSubmit = true;

        transactionController.addTransaction.mockResolvedValue({
          result: Promise.reject(new Error('Test Error')),
          transactionMeta: TRANSACTION_META_MOCK,
        });

        await expect(addTransaction(request)).rejects.toThrow('Test Error');
      });

      it('does not wait for result if waitForSubmit is false', async () => {
        transactionController.addTransaction.mockResolvedValue({
          result: new Promise(() => {
            /* Intentionally not resolved */
          }),
          transactionMeta: TRANSACTION_META_MOCK,
        });

        await expect(addTransaction(request)).resolves.toBeTruthy();
      });

      it('waits for result if waitForSubmit is true', async () => {
        request.waitForSubmit = true;

        let resultResolve;
        let completed = false;

        const resultPromise = new Promise<string>((resolve) => {
          resultResolve = resolve;
        });

        transactionController.addTransaction.mockResolvedValue({
          result: resultPromise,
          transactionMeta: TRANSACTION_META_MOCK,
        });

        addTransaction(request).then(() => {
          completed = true;
        });

        await flushPromises();

        expect(completed).toBe(false);

        resultResolve(TRANSACTION_META_MOCK.hash);

        await flushPromises();

        expect(completed).toBe(true);
      });
    });

    describe('if selected account is smart contract', () => {
      beforeEach(() => {
        request.selectedAccount.type = 'eip155:eip4337';
      });

      it('adds user operation', async () => {
        await addTransaction(request);

        expect(
          request.userOperationController.addUserOperationFromTransaction,
        ).toHaveBeenCalledTimes(1);
        expect(
          request.userOperationController.addUserOperationFromTransaction,
        ).toHaveBeenCalledWith(TRANSACTION_PARAMS_MOCK, {
          networkClientId: TRANSACTION_REQUEST_MOCK.networkClientId,
          origin: TRANSACTION_OPTIONS_MOCK.origin,
          requireApproval: TRANSACTION_OPTIONS_MOCK.requireApproval,
          swaps: undefined,
          type: TRANSACTION_OPTIONS_MOCK.type,
        });
      });

      it('starts polling', async () => {
        await addTransaction(request);

        expect(
          userOperationController.startPollingByNetworkClientId,
        ).toHaveBeenCalledTimes(1);
        expect(
          userOperationController.startPollingByNetworkClientId,
        ).toHaveBeenCalledWith(TRANSACTION_REQUEST_MOCK.networkClientId);
      });

      it('returns transaction meta', async () => {
        const transactionMeta = await addTransaction(request);
        expect(transactionMeta).toStrictEqual(TRANSACTION_META_MOCK);
      });

      it('does not wait for transaction hash promise if waitForSubmit is false', async () => {
        userOperationController.addUserOperationFromTransaction.mockResolvedValue(
          {
            id: TRANSACTION_META_MOCK.id,
            hash: undefined as never,
            transactionHash: () =>
              new Promise(() => {
                /* Intentionally not resolved */
              }),
          },
        );

        await expect(addTransaction(request)).resolves.toBeTruthy();
      });

      it('waits for transaction hash promise if waitForSubmit is true', async () => {
        request.waitForSubmit = true;

        let transactionHashResolve;
        let completed = false;

        const transactionHashPromise = new Promise<string>((resolve) => {
          transactionHashResolve = resolve;
        });

        userOperationController.addUserOperationFromTransaction.mockResolvedValue(
          {
            id: TRANSACTION_META_MOCK.id,
            hash: () => Promise.resolve(TRANSACTION_META_MOCK.hash),
            transactionHash: () => transactionHashPromise,
          },
        );

        addTransaction(request).then(() => {
          completed = true;
        });

        await flushPromises();

        expect(completed).toBe(false);

        transactionHashResolve(TRANSACTION_META_MOCK.hash);

        await flushPromises();

        expect(completed).toBe(true);
      });

      it('does not throw if transaction hash promise fails and waitForSubmit is false', async () => {
        userOperationController.addUserOperationFromTransaction.mockResolvedValue(
          {
            id: TRANSACTION_META_MOCK.id,
            hash: jest.fn().mockRejectedValue(new Error('Test Error')),
            transactionHash: jest.fn().mockResolvedValue({}),
          },
        );

        await expect(addTransaction(request)).resolves.toBeTruthy();
      });

      it('throws if transaction hash promise fails and waitForSubmit is true', async () => {
        request.waitForSubmit = true;

        userOperationController.addUserOperationFromTransaction.mockResolvedValue(
          {
            id: TRANSACTION_META_MOCK.id,
            hash: undefined as never,
            transactionHash: jest
              .fn()
              .mockRejectedValue(new Error('Test Error')),
          },
        );

        await expect(addTransaction(request)).rejects.toThrow('Test Error');
      });

      it('removes type from swaps metadata', async () => {
        request.transactionOptions.swaps = {
          meta: {
            sourceTokenSymbol: 'ETH',
            type: TransactionType.simpleSend,
          },
        };

        await addTransaction(request);

        expect(
          request.userOperationController.addUserOperationFromTransaction,
        ).toHaveBeenCalledTimes(1);
        expect(
          request.userOperationController.addUserOperationFromTransaction,
        ).toHaveBeenCalledWith(
          TRANSACTION_PARAMS_MOCK,
          expect.objectContaining({
            swaps: {
              sourceTokenSymbol: 'ETH',
            },
          }),
        );
      });

      it('normalises gas fees', async () => {
        request.transactionParams.maxFeePerGas = 'a';
        request.transactionParams.maxPriorityFeePerGas = 'b';

        await addTransaction(request);

        expect(
          request.userOperationController.addUserOperationFromTransaction,
        ).toHaveBeenCalledTimes(1);
        expect(
          request.userOperationController.addUserOperationFromTransaction,
        ).toHaveBeenCalledWith(
          {
            ...TRANSACTION_PARAMS_MOCK,
            maxFeePerGas: '0xa',
            maxPriorityFeePerGas: '0xb',
          },
          expect.anything(),
        );
      });
    });
  });

  describe('addDappTransaction', () => {
    describe('if selected account is EOA', () => {
      it('adds transaction', async () => {
        await addDappTransaction(dappRequest);

        expect(
          request.transactionController.addTransaction,
        ).toHaveBeenCalledTimes(1);
        expect(
          request.transactionController.addTransaction,
        ).toHaveBeenCalledWith(TRANSACTION_PARAMS_MOCK, {
          ...TRANSACTION_OPTIONS_MOCK,
          method: DAPP_REQUEST_MOCK.method,
          requireApproval: true,
          securityAlertResponse: DAPP_REQUEST_MOCK.securityAlertResponse,
          type: undefined,
        });
      });

      it('returns transaction hash', async () => {
        const transactionHash = await addDappTransaction(dappRequest);
        expect(transactionHash).toStrictEqual(TRANSACTION_META_MOCK.hash);
      });

      it('throws if result promise fails', async () => {
        transactionController.addTransaction.mockResolvedValue({
          result: Promise.reject(new Error('Test Error')),
          transactionMeta: TRANSACTION_META_MOCK,
        });

        await expect(addDappTransaction(dappRequest)).rejects.toThrow(
          'Test Error',
        );
      });
    });

    describe('if selected account is smart contract', () => {
      beforeEach(() => {
        request.selectedAccount.type = 'eip155:eip4337';
      });

      it('adds user operation', async () => {
        await addDappTransaction(dappRequest);

        expect(
          request.userOperationController.addUserOperationFromTransaction,
        ).toHaveBeenCalledTimes(1);
        expect(
          request.userOperationController.addUserOperationFromTransaction,
        ).toHaveBeenCalledWith(TRANSACTION_PARAMS_MOCK, {
          networkClientId: TRANSACTION_REQUEST_MOCK.networkClientId,
          origin: TRANSACTION_OPTIONS_MOCK.origin,
          requireApproval: true,
          swaps: undefined,
          type: undefined,
        });
      });

      it('starts polling', async () => {
        await addDappTransaction(dappRequest);

        expect(
          userOperationController.startPollingByNetworkClientId,
        ).toHaveBeenCalledTimes(1);
        expect(
          userOperationController.startPollingByNetworkClientId,
        ).toHaveBeenCalledWith(TRANSACTION_REQUEST_MOCK.networkClientId);
      });

      it('returns transaction hash', async () => {
        const transactionHash = await addDappTransaction(dappRequest);
        expect(transactionHash).toStrictEqual(TRANSACTION_META_MOCK.hash);
      });

      it('throws if transaction hash promise fails', async () => {
        userOperationController.addUserOperationFromTransaction.mockResolvedValue(
          {
            id: TRANSACTION_META_MOCK.id,
            hash: jest.fn().mockResolvedValue({}),
            transactionHash: jest
              .fn()
              .mockRejectedValue(new Error('Test Error')),
          },
        );

        await expect(addDappTransaction(dappRequest)).rejects.toThrow(
          'Test Error',
        );
      });
    });
  });
});