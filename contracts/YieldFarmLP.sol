// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IStaking.sol";
import "@nomiclabs/buidler/console.sol";

contract YieldFarmLP {

    // lib
    using SafeMath for uint;
    using SafeMath for uint128;

    // constants
    uint constant TOTAL_DISTRIBUTED_AMOUNT = 2000000;
    uint NR_OF_EPOCHS = 100;

     // state variables

    // addreses
    address private _uniLP;
    address private _communityVault;
    // contracts
    IERC20 private _bond;
    IStaking private _staking;


    uint[] private epochs = new uint[](NR_OF_EPOCHS + 1);
    uint128 public lastInitializedEpoch;
    mapping (address => uint128) lastEpochIdHarvested;
    uint epochDuration; // init from staking contract
    uint epochStart; // init from staking contract


    // modifiers
    // constructor
    constructor(address bondTokenAddress, address uniLP, address stakeContract, address communityVault) public {
        _bond = IERC20(bondTokenAddress);
        _uniLP = uniLP;
        _staking = IStaking(stakeContract);
        _communityVault = communityVault;
        epochDuration = _staking.epochDuration();
        epochStart = _staking.epoch1Start() + epochDuration;
    }

    // public methods
    function massHarvest () external returns (uint){
        uint totalDistributedValue;
        uint epochId = _getEpochId().sub(1);
        if (epochId > NR_OF_EPOCHS) {
            epochId = NR_OF_EPOCHS;
        }
        for(uint128 i = lastEpochIdHarvested[msg.sender] + 1; i <= epochId; i++) {
            // i = epochId
            totalDistributedValue += _harvest(i);
        }
        if (totalDistributedValue > 0) {
            _bond.transferFrom(_communityVault, msg.sender, totalDistributedValue);
        }
        return totalDistributedValue;
    }
    function harvest (uint128 epochId) external returns (uint){
        uint userReward = _harvest(epochId);
        if (userReward > 0) {
            _bond.transferFrom(_communityVault, msg.sender, userReward);
        }
        return userReward;
    }

    function initEpoch (uint128 epochId) external {
        _initEpoch(epochId);
    }

    // views
    function getPoolSize (uint128 epochId) external view returns (uint) {
        return _getPoolSize(epochId);
    }
    function getCurrentEpoch () external view returns (uint) {
        return _getEpochId();
    }
    function getEpochStake (address userAddress, uint128 epochId) external view returns (uint) {
        return _getUserBalancePerEpoch (userAddress, epochId);
    }

    function userLastEpochIdHarvested() external view returns (uint){
        return lastEpochIdHarvested[msg.sender];
    }

    // internal methods

    function _initEpoch (uint128 epochId) internal {
        require (lastInitializedEpoch.add(1) == epochId, "Epoch can be init only in order");
        lastInitializedEpoch = epochId;
        uint epochPoolSizeValue = _getPoolSize(epochId);
        epochs[epochId] = epochPoolSizeValue;
    }

    function _harvest (uint128 epochId) internal returns (uint) {
        // check that epoch is finished
        require (_getEpochId() > epochId, "This epoch is in the future");
        require(epochId <= NR_OF_EPOCHS, "Maximum number of epochs is 100");
        require (lastEpochIdHarvested[msg.sender].add(1) == epochId, "Epochs needs to be harvested in order");

        if (lastInitializedEpoch < epochId) {
            _initEpoch(epochId);
        }
        // Give user reward
        uint userReward;
        uint userBalancePerEpoch = _getUserBalancePerEpoch(msg.sender, epochId);
        if (userBalancePerEpoch > 0 && epochs[epochId] > 0) {
            userReward = TOTAL_DISTRIBUTED_AMOUNT.mul(10**18).div(NR_OF_EPOCHS)
            .mul(userBalancePerEpoch)
            .div(epochs[epochId]);
        }
        lastEpochIdHarvested[msg.sender] = epochId;
        return userReward; // reward
    }

    function _getPoolSize (uint128 epochId) internal view returns (uint) {
        return _staking.getEpochPoolSize(_uniLP, _stakingEpochId(epochId));
    }

    function _getUserBalancePerEpoch (address userAddress, uint128 epochId) internal view returns (uint){
        return _staking.getEpochUserBalance(userAddress, _uniLP, _stakingEpochId(epochId));
    }

    function _getEpochId () internal view returns (uint128 epochId) {
        if (block.timestamp < epochStart) {
            return 0;
        }
        epochId = uint128(block.timestamp.sub(epochStart).div(epochDuration).add(1));
    }

    function _stakingEpochId (uint128 epochId) pure internal returns (uint128) {
        return epochId + 1;
    }
}
