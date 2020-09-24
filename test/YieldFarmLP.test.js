const { expect } = require('chai')
const { ethers } = require('@nomiclabs/buidler')

describe('YieldFarm Liquidity Pool', function () {
    let yieldFarm
    let staking
    let owner, user, communityVault, userAddr, ownerAddr, communityVaultAddr
    let bondToken, uniLP
    const distributedAmount = ethers.BigNumber.from(2000000).mul(ethers.BigNumber.from(10).pow(18))
    // let barnBridge = '0x07865c6E87B9F70255377e024ace6630C1Eaa37F'
    // let usdc = '0x07865c6E87B9F70255377e024ace6630C1Eaa37F'
    // let susd = '0x07865c6E87B9F70255377e024ace6630C1Eaa37F'
    // let dai = '0x07865c6E87B9F70255377e024ace6630C1Eaa37F'
    // let uniLP = '0x07865c6E87B9F70255377e024ace6630C1Eaa37F'
    let snapshotId
    const epochDuration = 1000
    const NR_OF_EPOCHS = 100

    const amount = ethers.BigNumber.from(100).mul(ethers.BigNumber.from(10).pow(18))
    beforeEach(async function () {
        snapshotId = await ethers.provider.send('evm_snapshot')
        const [creator, ownerSigner, userSigner] = await ethers.getSigners()
        owner = ownerSigner
        ownerAddr = await owner.getAddress()

        user = userSigner
        userAddr = await user.getAddress()

        const Staking = await ethers.getContractFactory('Staking', creator)

        staking = await Staking.deploy(Math.floor(Date.now() / 1000) + 1000, epochDuration)
        await staking.deployed()

        const ERC20Mock = await ethers.getContractFactory('ERC20Mock')
        const CommunityVault = await ethers.getContractFactory('CommunityVault')

        bondToken = await ERC20Mock.deploy()
        uniLP = await ERC20Mock.deploy()
        communityVault = await CommunityVault.deploy(bondToken.address)
        communityVaultAddr = communityVault.address
        const YieldFarm = await ethers.getContractFactory('YieldFarmLP')
        yieldFarm = await YieldFarm.deploy(
            bondToken.address,
            uniLP.address,
            staking.address,
            communityVaultAddr,
        )
        await bondToken.mint(communityVaultAddr, distributedAmount)
        await communityVault.connect(creator).setAllowance(yieldFarm.address, distributedAmount)
    })

    afterEach(async function () {
        await ethers.provider.send('evm_revert', [snapshotId])
    })

    describe('General Contract checks', function () {
        it('should be deployed', async function () {
            expect(staking.address).to.not.equal(0)
            expect(yieldFarm.address).to.not.equal(0)
            expect(bondToken.address).to.not.equal(0)
        })

        it('Get epoch PoolSize and distribute tokens', async function () {
            await depositUniLP(amount)
            await moveAtEpoch(3)
            const totalAmount = amount

            expect(await yieldFarm.getPoolSize(1)).to.equal(totalAmount)
            expect(await yieldFarm.getEpochStake(userAddr, 1)).to.equal(totalAmount)
            expect(await bondToken.allowance(communityVaultAddr, yieldFarm.address)).to.equal(distributedAmount)
            expect(await yieldFarm.getCurrentEpoch()).to.equal(2) // epoch on yield is staking - 1

            await yieldFarm.connect(user).harvest(1)
            expect(await bondToken.balanceOf(userAddr)).to.equal(distributedAmount.div(NR_OF_EPOCHS))
        })
    })

    describe('Contract Tests', function () {
        it('User harvest and mass Harvest', async function () {
            await depositUniLP(amount)
            const totalAmount = amount
            // initialize epochs meanwhile
            await moveAtEpoch(9)
            expect(await yieldFarm.getPoolSize(1)).to.equal(amount)

            expect(await yieldFarm.lastInitializedEpoch()).to.equal(0) // no epoch initialized
            expect(yieldFarm.harvest(10)).to.be.revertedWith('This epoch is in the future')
            expect(yieldFarm.harvest(3)).to.be.revertedWith('Epochs needs to be harvested in order')
            await (await yieldFarm.connect(user).harvest(1)).wait()

            expect(await bondToken.balanceOf(userAddr)).to.equal(
                amount.mul(distributedAmount.div(NR_OF_EPOCHS)).div(totalAmount),
            )
            expect(await yieldFarm.connect(user).userLastEpochIdHarvested()).to.equal(1)
            expect(await yieldFarm.lastInitializedEpoch()).to.equal(1) // epoch 1 have been initialized

            await (await yieldFarm.connect(user).massHarvest()).wait()
            const totalDistributedAmount = amount.mul(distributedAmount.div(NR_OF_EPOCHS)).div(totalAmount).mul(7)
            expect(await bondToken.balanceOf(userAddr)).to.equal(totalDistributedAmount)
            expect(await yieldFarm.connect(user).userLastEpochIdHarvested()).to.equal(7)
            expect(await yieldFarm.lastInitializedEpoch()).to.equal(7) // epoch 7 have been initialized
        })

        it('init an uninit epoch', async function () {
            await moveAtEpoch(5)
            expect(await yieldFarm.lastInitializedEpoch()).to.equal(0) // no epoch initialized
            await yieldFarm.initEpoch(1)
            expect(await yieldFarm.lastInitializedEpoch()).to.equal(1) // no epoch initialized
        })

        it('harvest maximum 100 epochs', async function () {
            await depositUniLP(amount)
            const totalAmount = amount
            await moveAtEpoch(300)

            expect(await yieldFarm.getPoolSize(1)).to.equal(totalAmount)
            await (await yieldFarm.connect(user).massHarvest()).wait()
            expect(await yieldFarm.lastInitializedEpoch()).to.equal(NR_OF_EPOCHS)
        })

        it('gives epochid = 0 for previous epochs', async function () {
            await moveAtEpoch(-2)
            expect(await yieldFarm.getCurrentEpoch()).to.equal(0)
        })
    })

    describe('Events', function () {
        it('Harvest emits Harvest', async function () {
            await depositUniLP(amount)
            await moveAtEpoch(9)

            await expect(yieldFarm.connect(user).harvest(1))
                .to.emit(yieldFarm, 'Harvest')
        })

        it('MassHarvest emits MassHarvest', async function () {
            await depositUniLP(amount)
            await moveAtEpoch(9)

            await expect(yieldFarm.connect(user).massHarvest())
                .to.emit(yieldFarm, 'MassHarvest')
        })
    })

    function getCurrentUnix () {
        return Math.floor(Date.now() / 1000)
    }

    async function setNextBlockTimestamp (timestamp) {
        const block = await ethers.provider.send('eth_getBlockByNumber', ['latest', false])
        const currentTs = block.timestamp
        const diff = timestamp - currentTs
        await ethers.provider.send('evm_increaseTime', [diff])
    }

    async function moveAtEpoch (epoch) {
        await setNextBlockTimestamp(getCurrentUnix() + epochDuration * epoch)
        await ethers.provider.send('evm_mine')
    }

    async function depositUniLP (x, u = user) {
        const ua = await u.getAddress()
        await uniLP.mint(ua, x)
        await uniLP.connect(u).approve(staking.address, x)
        return await staking.connect(u).deposit(uniLP.address, x)
    }
})
